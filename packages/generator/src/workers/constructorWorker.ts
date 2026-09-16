import { parseConstructorWorkerRequest, solveFillAsync, type ConstructorWorkerRequest, type ConstructorWorkerResponse } from '@crossword/construction';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ConstructorWorkerRequest>) => void) | null;
  postMessage: (message: ConstructorWorkerResponse) => void;
};
const jobs = new Map<string, AbortController>();

workerScope.onmessage = (event) => {
  const message = parseConstructorWorkerRequest(event.data);
  if (!message) {
    workerScope.postMessage({ version: 1, type: 'protocol-error', message: 'Unsupported constructor worker message' });
    return;
  }
  if (message.type === 'cancel') {
    jobs.get(message.jobId)?.abort();
    return;
  }
  if (jobs.has(message.jobId)) {
    workerScope.postMessage({ version: 1, type: 'protocol-error', jobId: message.jobId, message: 'Constructor job is already running' });
    return;
  }

  const controller = new AbortController();
  jobs.set(message.jobId, controller);
  void solveFillAsync(message.request, {
    signal: controller.signal,
    onProgress: (progress) => workerScope.postMessage({ version: 1, type: 'progress', jobId: message.jobId, progress })
  }).then((result) => {
    workerScope.postMessage({ version: 1, type: 'result', jobId: message.jobId, result });
  }).catch((error: unknown) => {
    workerScope.postMessage({
      version: 1,
      type: 'protocol-error',
      jobId: message.jobId,
      message: error instanceof Error ? error.message : 'Constructor worker failed'
    });
  }).finally(() => {
    jobs.delete(message.jobId);
  });
};
