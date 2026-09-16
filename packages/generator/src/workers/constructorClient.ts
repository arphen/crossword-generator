import {
  parseConstructorWorkerResponse,
  type ConstructorWorkerRequest,
  type ConstructorWorkerResponse,
  type FillProgress,
  type FillRequest,
  type FillResult
} from '@crossword/construction';

export interface ConstructorWorkerClient {
  solve(request: FillRequest, options?: { signal?: AbortSignal; onProgress?: (progress: FillProgress) => void }): Promise<FillResult>;
  cancel(jobId: string): void;
  dispose(): void;
}

type PendingJob = {
  resolve: (result: FillResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: FillProgress) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

function responseJobId(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null && 'jobId' in value && typeof value.jobId === 'string' ? value.jobId : undefined;
}

export function createConstructorWorkerClient(worker: Worker): ConstructorWorkerClient {
  const pending = new Map<string, PendingJob>();
  let nextJobId = 1;

  const settle = (jobId: string, action: (job: PendingJob) => void) => {
    const job = pending.get(jobId);
    if (!job) return;
    pending.delete(jobId);
    if (job.signal && job.onAbort) job.signal.removeEventListener('abort', job.onAbort);
    action(job);
  };

  const rejectAll = (error: Error) => {
    for (const jobId of pending.keys()) settle(jobId, (job) => job.reject(error));
  };

  const handleMessage = (event: MessageEvent<unknown>) => {
    const message = parseConstructorWorkerResponse(event.data);
    if (!message) {
      const jobId = responseJobId(event.data);
      if (jobId) settle(jobId, (job) => job.reject(new Error('Invalid constructor worker response')));
      else rejectAll(new Error('Invalid constructor worker response'));
      return;
    }
    if (message.type === 'progress') {
      pending.get(message.jobId)?.onProgress?.(message.progress);
      return;
    }
    if (message.type === 'result') {
      settle(message.jobId, (job) => job.resolve(message.result));
      return;
    }
    if (message.jobId) settle(message.jobId, (job) => job.reject(new Error(message.message)));
    else rejectAll(new Error(message.message));
  };

  const handleError = () => rejectAll(new Error('Constructor worker stopped unexpectedly'));
  worker.addEventListener('message', handleMessage);
  worker.addEventListener('error', handleError);

  const sendCancel = (jobId: string) => {
    if (!pending.has(jobId)) return;
    const message: ConstructorWorkerRequest = { version: 1, type: 'cancel', jobId };
    worker.postMessage(message);
  };

  return {
    solve(request, options = {}) {
      const jobId = `constructor-${nextJobId++}`;
      const message: ConstructorWorkerRequest = { version: 1, type: 'solve', jobId, request };
      const promise = new Promise<FillResult>((resolve, reject) => {
        const job: PendingJob = { resolve, reject, onProgress: options.onProgress, signal: options.signal };
        if (options.signal) {
          job.onAbort = () => sendCancel(jobId);
          options.signal.addEventListener('abort', job.onAbort, { once: true });
        }
        pending.set(jobId, job);
      });
      worker.postMessage(message);
      if (options.signal?.aborted) sendCancel(jobId);
      return promise;
    },
    cancel: sendCancel,
    dispose() {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      rejectAll(new Error('Constructor worker client disposed'));
      worker.terminate();
    }
  };
}

export function createBrowserConstructorWorker(): ConstructorWorkerClient {
  const worker = new Worker(new URL('./constructorWorker.ts', import.meta.url), { type: 'module' });
  return createConstructorWorkerClient(worker);
}