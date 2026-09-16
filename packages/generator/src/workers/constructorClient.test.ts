import { describe, expect, it, vi } from 'vitest';
import type { ConstructorWorkerRequest, ConstructorWorkerResponse, FillRequest } from '@crossword/construction';
import { createConstructorWorkerClient } from './constructorClient';

class FakeWorker {
  readonly posted: ConstructorWorkerRequest[] = [];
  private readonly messageListeners = new Set<(event: MessageEvent<unknown>) => void>();
  private readonly errorListeners = new Set<() => void>();
  terminated = false;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') this.messageListeners.add(listener as (event: MessageEvent<unknown>) => void);
    if (type === 'error') this.errorListeners.add(listener as () => void);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') this.messageListeners.delete(listener as (event: MessageEvent<unknown>) => void);
    if (type === 'error') this.errorListeners.delete(listener as () => void);
  }

  postMessage(message: ConstructorWorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: ConstructorWorkerResponse | unknown): void {
    const event = { data: message } as MessageEvent<unknown>;
    for (const listener of this.messageListeners) listener(event);
  }

  emitError(): void {
    for (const listener of this.errorListeners) listener();
  }
}

const request: FillRequest = {
  slots: [{ id: 'slot', length: 3 }],
  intersections: [],
  candidates: [{ word: 'CAT', score: 1, lexemeId: 'cat', sourceIds: ['fixture'] }]
};

describe('constructor worker client', () => {
  it('routes progress and resolves a worker result', async () => {
    const worker = new FakeWorker();
    const client = createConstructorWorkerClient(worker as unknown as Worker);
    const onProgress = vi.fn();
    const promise = client.solve(request, { onProgress });
    const solve = worker.posted[0];
    if (!solve || solve.type !== 'solve') throw new Error('Expected solve request');

    worker.emit({ version: 1, type: 'progress', jobId: solve.jobId, progress: { type: 'progress', nodes: 1, assigned: 0, openSlots: 1, bestScore: 0 } });
    worker.emit({ version: 1, type: 'result', jobId: solve.jobId, result: { status: 'failed', failure: { code: 'unsatisfiable', message: 'no fill', nodes: 1 } } });

    await expect(promise).resolves.toMatchObject({ status: 'failed' });
    expect(onProgress).toHaveBeenCalledOnce();
  });

  it('sends cancellation and rejects malformed or stopped jobs', async () => {
    const worker = new FakeWorker();
    const client = createConstructorWorkerClient(worker as unknown as Worker);
    const controller = new AbortController();
    const promise = client.solve(request, { signal: controller.signal });
    const solve = worker.posted[0];
    if (!solve || solve.type !== 'solve') throw new Error('Expected solve request');
    controller.abort();
    expect(worker.posted[1]).toEqual({ version: 1, type: 'cancel', jobId: solve.jobId });
    worker.emit({ version: 1, type: 'result', jobId: solve.jobId, result: { status: 'failed', failure: { code: 'cancelled', message: 'stopped', nodes: 1 } } });
    await expect(promise).resolves.toMatchObject({ failure: { code: 'cancelled' } });

    const malformed = client.solve(request);
    const malformedRequest = worker.posted[2];
    if (!malformedRequest || malformedRequest.type !== 'solve') throw new Error('Expected second solve request');
    worker.emit({ version: 1, type: 'result', jobId: malformedRequest.jobId, result: { status: 'unknown' } });
    await expect(malformed).rejects.toThrow('Invalid constructor worker response');

    const stopped = client.solve(request);
    worker.emitError();
    await expect(stopped).rejects.toThrow('stopped unexpectedly');
    client.dispose();
    expect(worker.terminated).toBe(true);
  });
});