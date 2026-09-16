import {
  parseModelWorkerResponse,
  type BrokerResult,
  type CandidateRequest,
  type CandidateSuggestion,
  type ClueDraft,
  type ModelManifest,
  type ModelState,
  type ModelWorkerConfig,
  type ModelWorkerOperation,
  type ModelWorkerRequest,
  type RuntimeProbe
} from '@crossword/model-runtime';

export interface ModelWorkerClient {
  configure(config: ModelWorkerConfig): Promise<BrokerResult<void>>;
  install(signal?: AbortSignal): Promise<BrokerResult<void>>;
  load(signal?: AbortSignal): Promise<BrokerResult<void>>;
  generateCandidates(request: CandidateRequest, signal?: AbortSignal): Promise<BrokerResult<readonly CandidateSuggestion[]>>;
  composeClues(request: Readonly<{ answer: string; intendedSense: string }>, signal?: AbortSignal): Promise<BrokerResult<readonly ClueDraft[]>>;
  unload(signal?: AbortSignal): Promise<BrokerResult<void>>;
  state(): ModelState;
  cancel(requestId: string): void;
  dispose(): void;
}

type PendingJob = {
  resolve: (result: BrokerResult<unknown>) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

function responseRequestId(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null && 'requestId' in value && typeof value.requestId === 'string' ? value.requestId : undefined;
}

export function createModelWorkerClient(worker: Worker): ModelWorkerClient {
  const pending = new Map<string, PendingJob>();
  let nextRequestId = 1;
  let currentState: ModelState = 'uninstalled';

  const settle = (requestId: string, action: (job: PendingJob) => void) => {
    const job = pending.get(requestId);
    if (!job) return;
    pending.delete(requestId);
    if (job.signal && job.onAbort) job.signal.removeEventListener('abort', job.onAbort);
    action(job);
  };

  const rejectAll = (error: Error) => {
    for (const requestId of pending.keys()) settle(requestId, (job) => job.reject(error));
  };

  const handleMessage = (event: MessageEvent<unknown>) => {
    const message = parseModelWorkerResponse(event.data);
    if (!message) {
      const requestId = responseRequestId(event.data);
      if (requestId) settle(requestId, (job) => job.reject(new Error('Invalid model worker response')));
      else rejectAll(new Error('Invalid model worker response'));
      return;
    }
    if (message.type === 'state') {
      currentState = message.state;
      return;
    }
    if (message.type === 'result') {
      settle(message.requestId, (job) => job.resolve(message.result));
      return;
    }
    if (message.requestId) settle(message.requestId, (job) => job.reject(new Error(message.message)));
    else rejectAll(new Error(message.message));
  };

  const handleError = () => rejectAll(new Error('Model worker stopped unexpectedly'));
  worker.addEventListener('message', handleMessage);
  worker.addEventListener('error', handleError);

  const sendCancel = (requestId: string) => {
    if (!pending.has(requestId)) return;
    const message: ModelWorkerRequest = { version: 1, type: 'cancel', requestId };
    worker.postMessage(message);
  };

  const run = <T>(operation: ModelWorkerOperation, payload: CandidateRequest | Readonly<{ answer: string; intendedSense: string }> | undefined, signal?: AbortSignal): Promise<BrokerResult<T>> => {
    const requestId = `model-${nextRequestId++}`;
    const promise = new Promise<BrokerResult<unknown>>((resolve, reject) => {
      const job: PendingJob = { resolve, reject, signal };
      if (signal) {
        job.onAbort = () => sendCancel(requestId);
        signal.addEventListener('abort', job.onAbort, { once: true });
      }
      pending.set(requestId, job);
    });
    worker.postMessage({ version: 1, type: 'execute', requestId, operation, payload });
    if (signal?.aborted) sendCancel(requestId);
    return promise as Promise<BrokerResult<T>>;
  };

  return {
    configure(config) {
      const requestId = `model-${nextRequestId++}`;
      const promise = new Promise<BrokerResult<unknown>>((resolve, reject) => pending.set(requestId, { resolve, reject }));
      worker.postMessage({ version: 1, type: 'configure', requestId, config });
      return promise as Promise<BrokerResult<void>>;
    },
    install: (signal) => run<void>('install', undefined, signal),
    load: (signal) => run<void>('load', undefined, signal),
    generateCandidates: (request, signal) => run<readonly CandidateSuggestion[]>('generate-candidates', request, signal),
    composeClues: (request, signal) => run<readonly ClueDraft[]>('compose-clues', request, signal),
    unload: (signal) => run<void>('unload', undefined, signal),
    state: () => currentState,
    cancel: sendCancel,
    dispose() {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      rejectAll(new Error('Model worker client disposed'));
      worker.terminate();
    }
  };
}

export function createBrowserModelWorkerClient(): ModelWorkerClient {
  const worker = new Worker(new URL('./modelWorker.ts', import.meta.url), { type: 'module' });
  return createModelWorkerClient(worker);
}

export type { ModelManifest, RuntimeProbe };