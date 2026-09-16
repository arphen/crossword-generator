import {
  createModelBroker,
  createWebLLMAdapter,
  parseModelWorkerRequest,
  type ModelBroker,
  type ModelWorkerRequest,
  type ModelWorkerResponse
} from '@crossword/model-runtime';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ModelWorkerRequest>) => void) | null;
  postMessage: (message: ModelWorkerResponse) => void;
};
let broker: ModelBroker | undefined;
const jobs = new Map<string, AbortController>();

const postState = () => {
  if (broker) workerScope.postMessage({ version: 1, type: 'state', state: broker.state() });
};

workerScope.onmessage = (event) => {
  const message = parseModelWorkerRequest(event.data);
  if (!message) {
    workerScope.postMessage({ version: 1, type: 'protocol-error', message: 'Unsupported model worker message' });
    return;
  }
  if (message.type === 'cancel') {
    jobs.get(message.requestId)?.abort();
    return;
  }
  if (message.type === 'configure') {
    if (jobs.size > 0) {
      workerScope.postMessage({ version: 1, type: 'protocol-error', requestId: message.requestId, message: 'Cannot reconfigure while model work is running' });
      return;
    }
    try {
      broker = createModelBroker(message.config.manifest, createWebLLMAdapter(), message.config.runtime);
      workerScope.postMessage({ version: 1, type: 'result', requestId: message.requestId, operation: 'configure', result: { ok: true, value: undefined } });
      postState();
    } catch (error) {
      workerScope.postMessage({ version: 1, type: 'protocol-error', requestId: message.requestId, message: error instanceof Error ? error.message : 'Model worker configuration failed' });
    }
    return;
  }
  if (!broker) {
    workerScope.postMessage({ version: 1, type: 'protocol-error', requestId: message.requestId, message: 'Configure the model worker before use' });
    return;
  }
  if (jobs.has(message.requestId)) {
    workerScope.postMessage({ version: 1, type: 'protocol-error', requestId: message.requestId, message: 'Model request is already running' });
    return;
  }
  const controller = new AbortController();
  jobs.set(message.requestId, controller);
  const payload = message.payload;
  const operation = message.operation;
  const result = operation === 'install'
    ? broker.install(controller.signal)
    : operation === 'load'
      ? broker.load(controller.signal)
      : operation === 'generate-candidates'
        ? broker.generateCandidates(payload as Parameters<ModelBroker['generateCandidates']>[0], controller.signal)
        : operation === 'compose-clues'
          ? broker.composeClues(payload as Parameters<ModelBroker['composeClues']>[0], controller.signal)
          : broker.unload();
  void result.then((value) => {
    workerScope.postMessage({ version: 1, type: 'result', requestId: message.requestId, operation, result: value });
    postState();
  }).catch((error: unknown) => {
    workerScope.postMessage({ version: 1, type: 'protocol-error', requestId: message.requestId, message: error instanceof Error ? error.message : 'Model worker operation failed' });
  }).finally(() => jobs.delete(message.requestId));
};