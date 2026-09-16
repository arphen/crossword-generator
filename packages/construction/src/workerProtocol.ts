import type { FillProgress, FillRequest, FillResult } from './csp';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isCandidate(value: unknown): boolean {
  if (!isRecord(value) || typeof value.word !== 'string' || value.word.trim().length === 0 || !isFiniteNumber(value.score) || typeof value.lexemeId !== 'string' || value.lexemeId.length === 0 || !Array.isArray(value.sourceIds) || value.sourceIds.length === 0) return false;
  return value.sourceIds.every((sourceId) => typeof sourceId === 'string' && sourceId.length > 0);
}

function isFillSlot(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.length !== 'number' || !Number.isInteger(value.length) || value.length < 1) return false;
  return value.pattern === undefined || (typeof value.pattern === 'string' && value.pattern.length === value.length && /^[A-Z.]*$/.test(value.pattern));
}

function isIntersection(value: unknown): boolean {
  if (!isRecord(value) || typeof value.slotId !== 'string' || typeof value.otherSlotId !== 'string') return false;
  return isNonNegativeInteger(value.position) && isNonNegativeInteger(value.otherPosition);
}

function isFillRequest(value: unknown): value is FillRequest {
  if (!isRecord(value) || !Array.isArray(value.slots) || !Array.isArray(value.intersections) || !Array.isArray(value.candidates)) return false;
  if (!value.slots.every(isFillSlot)) return false;
  if (!value.intersections.every(isIntersection)) return false;
  if (!value.candidates.every(isCandidate)) return false;
  if (value.seed !== undefined && !Number.isInteger(value.seed)) return false;
  if (value.maxNodes !== undefined && (typeof value.maxNodes !== 'number' || !Number.isInteger(value.maxNodes) || value.maxNodes < 1)) return false;
  if (value.qualityThreshold !== undefined && !isFiniteNumber(value.qualityThreshold)) return false;
  return value.excludedWords === undefined || (Array.isArray(value.excludedWords) && value.excludedWords.every((word) => typeof word === 'string'));
}

export type ConstructorWorkerRequest = Readonly<
  | { version: 1; type: 'solve'; jobId: string; request: FillRequest }
  | { version: 1; type: 'cancel'; jobId: string }
>;

export type ConstructorWorkerResponse = Readonly<
  | { version: 1; type: 'progress'; jobId: string; progress: FillProgress }
  | { version: 1; type: 'result'; jobId: string; result: FillResult }
  | { version: 1; type: 'protocol-error'; jobId?: string; message: string }
>;

export function parseConstructorWorkerRequest(value: unknown): ConstructorWorkerRequest | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.type !== 'string' || typeof value.jobId !== 'string' || !value.jobId) return undefined;
  if (value.type === 'cancel') return { version: 1, type: 'cancel', jobId: value.jobId };
  if (value.type !== 'solve' || !isFillRequest(value.request)) return undefined;
  return { version: 1, type: 'solve', jobId: value.jobId, request: value.request };
}

function isProgress(value: unknown): value is FillProgress {
  return isRecord(value)
    && value.type === 'progress'
    && Number.isInteger(value.nodes)
    && Number.isInteger(value.assigned)
    && Number.isInteger(value.openSlots)
    && (isFiniteNumber(value.bestScore) || value.bestScore === Number.NEGATIVE_INFINITY);
}

function isResult(value: unknown): value is FillResult {
  if (!isRecord(value) || !['solved', 'failed'].includes(value.status as string)) return false;
  if (value.status === 'solved') {
    const solution = value.solution;
    return isRecord(solution)
      && isFiniteNumber(solution.score)
      && isNonNegativeInteger(solution.nodes)
      && isRecord(solution.assignments)
      && Object.values(solution.assignments).every(isCandidate);
  }
  const failure = value.failure;
  if (!isRecord(failure) || !['unsatisfiable', 'cancelled', 'resource-limit', 'invalid-request'].includes(failure.code as string)) return false;
  return typeof failure.message === 'string' && isNonNegativeInteger(failure.nodes);
}

export function parseConstructorWorkerResponse(value: unknown): ConstructorWorkerResponse | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.type !== 'string') return undefined;
  if (value.type === 'protocol-error' && typeof value.message === 'string' && (value.jobId === undefined || typeof value.jobId === 'string')) {
    return { version: 1, type: 'protocol-error', jobId: value.jobId, message: value.message };
  }
  if (typeof value.jobId !== 'string' || !value.jobId) return undefined;
  if (value.type === 'progress' && isProgress(value.progress)) return { version: 1, type: 'progress', jobId: value.jobId, progress: value.progress };
  if (value.type === 'result' && isResult(value.result)) return { version: 1, type: 'result', jobId: value.jobId, result: value.result };
  return undefined;
}
