import { describe, expect, it } from 'vitest';
import { parseConstructorWorkerRequest, parseConstructorWorkerResponse } from './workerProtocol';

const request = {
  slots: [{ id: 'slot', length: 3 }],
  intersections: [],
  candidates: [{ word: 'CAT', score: 1, lexemeId: 'cat', sourceIds: ['fixture'] }]
};

describe('constructor worker protocol', () => {
  it('accepts valid solve and cancel requests', () => {
    expect(parseConstructorWorkerRequest({ version: 1, type: 'solve', jobId: 'job-1', request })).toMatchObject({ type: 'solve', jobId: 'job-1' });
    expect(parseConstructorWorkerRequest({ version: 1, type: 'cancel', jobId: 'job-1' })).toEqual({ version: 1, type: 'cancel', jobId: 'job-1' });
  });

  it('rejects malformed requests and responses', () => {
    expect(parseConstructorWorkerRequest({ version: 1, type: 'solve', jobId: 'job-1', request: { ...request, candidates: [{ ...request.candidates[0], score: 'high' }] } })).toBeUndefined();
    expect(parseConstructorWorkerRequest({ version: 2, type: 'cancel', jobId: 'job-1' })).toBeUndefined();
    expect(parseConstructorWorkerResponse({ version: 1, type: 'result', jobId: 'job-1', result: { status: 'unknown' } })).toBeUndefined();
  });

  it('accepts bounded progress and failure responses', () => {
    expect(parseConstructorWorkerResponse({
      version: 1,
      type: 'progress',
      jobId: 'job-1',
      progress: { type: 'progress', nodes: 1, assigned: 0, openSlots: 1, bestScore: Number.NEGATIVE_INFINITY }
    })).toMatchObject({ type: 'progress', jobId: 'job-1' });
    expect(parseConstructorWorkerResponse({
      version: 1,
      type: 'result',
      jobId: 'job-1',
      result: { status: 'failed', failure: { code: 'cancelled', message: 'stopped', nodes: 1 } }
    })).toMatchObject({ type: 'result', jobId: 'job-1' });
  });
});