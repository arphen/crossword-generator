import { describe, expect, it } from 'vitest';
import type { ModelWorkerRequest, ModelWorkerResponse } from '@crossword/model-runtime';
import { createModelWorkerClient } from './modelClient';

class FakeWorker {
  readonly posted: ModelWorkerRequest[] = [];
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

  postMessage(message: ModelWorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: ModelWorkerResponse | unknown): void {
    const event = { data: message } as MessageEvent<unknown>;
    for (const listener of this.messageListeners) listener(event);
  }

  emitError(): void {
    for (const listener of this.errorListeners) listener();
  }
}

describe('model worker client', () => {
  it('tracks state and resolves broker results', async () => {
    const worker = new FakeWorker();
    const client = createModelWorkerClient(worker as unknown as Worker);
    const promise = client.load();
    const request = worker.posted[0];
    if (!request || request.type !== 'execute') throw new Error('Expected execute request');
    worker.emit({ version: 1, type: 'state', state: 'loaded' });
    worker.emit({ version: 1, type: 'result', requestId: request.requestId, operation: 'load', result: { ok: true, value: undefined } });
    await expect(promise).resolves.toEqual({ ok: true, value: undefined });
    expect(client.state()).toBe('loaded');
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('cancels aborted requests and rejects worker failures', async () => {
    const worker = new FakeWorker();
    const client = createModelWorkerClient(worker as unknown as Worker);
    const controller = new AbortController();
    const promise = client.generateCandidates({ seed: 'fixture', audienceSummary: 'broad', requestedRoles: ['general'], excludedAnswers: [], maxSuggestions: 1 }, controller.signal);
    const request = worker.posted[0];
    if (!request || request.type !== 'execute') throw new Error('Expected execute request');
    controller.abort();
    expect(worker.posted[1]).toEqual({ version: 1, type: 'cancel', requestId: request.requestId });
    worker.emitError();
    await expect(promise).rejects.toThrow('stopped unexpectedly');
    client.dispose();
  });
});