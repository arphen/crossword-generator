export type FillSlot = Readonly<{
  id: string;
  length: number;
  pattern?: string;
  importance?: number;
}>;

export type FillIntersection = Readonly<{
  slotId: string;
  position: number;
  otherSlotId: string;
  otherPosition: number;
}>;

export type FillCandidate = Readonly<{
  word: string;
  score: number;
  lexemeId: string;
  senseId?: string;
  sourceIds: readonly string[];
  tags?: readonly string[];
}>;

export type FillRequest = Readonly<{
  slots: readonly FillSlot[];
  intersections: readonly FillIntersection[];
  candidates: readonly FillCandidate[];
  seed?: number;
  maxNodes?: number;
  qualityThreshold?: number;
  excludedWords?: readonly string[];
}>;

export type FillProgress = Readonly<{
  type: 'progress';
  nodes: number;
  assigned: number;
  openSlots: number;
  bestScore: number;
}>;

export type FillFailureCode = 'unsatisfiable' | 'cancelled' | 'resource-limit' | 'invalid-request';

export type FillSolution = Readonly<{
  assignments: Readonly<Record<string, FillCandidate>>;
  score: number;
  nodes: number;
}>;

export type FillResult = Readonly<{
  status: 'solved' | 'failed';
  solution?: FillSolution;
  failure?: Readonly<{
    code: FillFailureCode;
    message: string;
    nodes: number;
  }>;
}>;

export type FillOptions = Readonly<{
  signal?: AbortSignal;
  onProgress?: (progress: FillProgress) => void;
}>;

type Bits = Uint32Array;

type IndexedCandidate = FillCandidate & Readonly<{
  normalizedWord: string;
  index: number;
}>;

type IndexedRequest = Readonly<{
  slots: readonly FillSlot[];
  intersections: readonly FillIntersection[];
  candidates: readonly IndexedCandidate[];
  candidatesByLength: ReadonlyMap<number, readonly number[]>;
  positionBits: ReadonlyMap<string, Bits>;
  slotById: ReadonlyMap<string, FillSlot>;
  intersectionsBySlot: ReadonlyMap<string, readonly FillIntersection[]>;
  excludedWords: ReadonlySet<string>;
}>;

function bitCount(bits: Bits): number {
  let count = 0;
  for (const word of bits) {
    let current = word;
    while (current !== 0) {
      current &= current - 1;
      count += 1;
    }
  }
  return count;
}

function cloneBits(bits: Bits): Bits {
  return bits.slice();
}

function intersectInto(target: Bits, allowed: Bits): boolean {
  let changed = false;
  for (let index = 0; index < target.length; index += 1) {
    const next = target[index]! & allowed[index]!;
    changed ||= next !== target[index];
    target[index] = next;
  }
  return changed;
}

function removeBit(bits: Bits, index: number): boolean {
  const wordIndex = index >>> 5;
  const mask = 1 << (index & 31);
  if ((bits[wordIndex]! & mask) === 0) return false;
  bits[wordIndex] = bits[wordIndex]! & ~mask;
  return true;
}

function hasBit(bits: Bits, index: number): boolean {
  return (bits[index >>> 5]! & (1 << (index & 31))) !== 0;
}

function candidateIndexes(bits: Bits): number[] {
  const indexes: number[] = [];
  for (let wordIndex = 0; wordIndex < bits.length; wordIndex += 1) {
    let word = bits[wordIndex]!;
    while (word !== 0) {
      const lowest = word & -word;
      const offset = 31 - Math.clz32(lowest);
      indexes.push((wordIndex << 5) + offset);
      word ^= lowest;
    }
  }
  return indexes;
}

function seededTieBreak(seed: number, value: string): number {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function normalizeCandidate(candidate: FillCandidate, index: number): IndexedCandidate | undefined {
  const normalizedWord = candidate.word.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalizedWord) || !Number.isFinite(candidate.score) || !candidate.lexemeId || candidate.sourceIds.length === 0) return undefined;
  return { ...candidate, normalizedWord, index };
}

function createIndex(request: FillRequest): IndexedRequest | { failure: FillResult['failure'] } {
  const slotsById = new Map<string, FillSlot>();
  for (const slot of request.slots) {
    if (slotsById.has(slot.id) || !slot.id || !Number.isInteger(slot.length) || slot.length < 1 || (slot.pattern !== undefined && (slot.pattern.length !== slot.length || !/^[A-Z.]*$/.test(slot.pattern)))) {
      return { failure: { code: 'invalid-request', message: `Invalid fill slot: ${slot.id}`, nodes: 0 } };
    }
    slotsById.set(slot.id, slot);
  }
  if (slotsById.size === 0) return { failure: { code: 'invalid-request', message: 'Fill request has no slots', nodes: 0 } };

  const candidates: IndexedCandidate[] = [];
  const candidatesByLength = new Map<number, number[]>();
  const wordIds = new Set<string>();
  for (const [index, candidate] of request.candidates.entries()) {
    const normalized = normalizeCandidate(candidate, index);
    if (!normalized || wordIds.has(normalized.normalizedWord) || request.excludedWords?.some((word) => word.toUpperCase() === normalized.normalizedWord)) continue;
    wordIds.add(normalized.normalizedWord);
    candidates.push({ ...normalized, index: candidates.length });
    const indexes = candidatesByLength.get(normalized.normalizedWord.length) ?? [];
    indexes.push(candidates.length - 1);
    candidatesByLength.set(normalized.normalizedWord.length, indexes);
  }
  if (candidates.length === 0) return { failure: { code: 'unsatisfiable', message: 'No eligible candidates remain', nodes: 0 } };

  const positionBits = new Map<string, Bits>();
  const wordCount = candidates.length;
  const bitWords = Math.ceil(wordCount / 32);
  for (const candidate of candidates) {
    for (let position = 0; position < candidate.normalizedWord.length; position += 1) {
      const letter = candidate.normalizedWord[position]!;
      const key = `${candidate.normalizedWord.length}:${position}:${letter}`;
      const bits = positionBits.get(key) ?? new Uint32Array(bitWords);
      bits[candidate.index >>> 5] = bits[candidate.index >>> 5]! | (1 << (candidate.index & 31));
      positionBits.set(key, bits);
    }
  }

  const intersectionsBySlot = new Map<string, FillIntersection[]>();
  for (const intersection of request.intersections) {
    const slot = slotsById.get(intersection.slotId);
    const other = slotsById.get(intersection.otherSlotId);
    if (!slot || !other || !Number.isInteger(intersection.position) || !Number.isInteger(intersection.otherPosition) || intersection.position < 0 || intersection.position >= slot.length || intersection.otherPosition < 0 || intersection.otherPosition >= other.length) {
      return { failure: { code: 'invalid-request', message: 'Intersection references an invalid slot position', nodes: 0 } };
    }
    const entries = intersectionsBySlot.get(intersection.slotId) ?? [];
    entries.push(intersection);
    intersectionsBySlot.set(intersection.slotId, entries);
  }

  return {
    slots: request.slots,
    intersections: request.intersections,
    candidates,
    candidatesByLength,
    positionBits,
    slotById: slotsById,
    intersectionsBySlot,
    excludedWords: new Set(request.excludedWords?.map((word) => word.toUpperCase()) ?? [])
  };
}

function initialDomain(index: IndexedRequest, slot: FillSlot): Bits {
  const domain = new Uint32Array(Math.ceil(index.candidates.length / 32));
  for (const candidateIndex of index.candidatesByLength.get(slot.length) ?? []) {
    const candidate = index.candidates[candidateIndex]!;
    if (slot.pattern && [...slot.pattern].some((letter, position) => letter !== '.' && candidate.normalizedWord[position] !== letter)) continue;
    domain[candidateIndex >>> 5] = domain[candidateIndex >>> 5]! | (1 << (candidateIndex & 31));
  }
  return domain;
}

function compatibleBits(
  index: IndexedRequest,
  targetLength: number,
  targetPosition: number,
  sourcePosition: number,
  source: Bits
): Bits {
  const result = new Uint32Array(source.length);
  for (const candidateIndex of candidateIndexes(source)) {
    const candidate = index.candidates[candidateIndex]!;
    const letter = candidate.normalizedWord[sourcePosition];
    if (!letter) continue;
    const allowed = index.positionBits.get(`${targetLength}:${targetPosition}:${letter}`);
    if (allowed) {
      for (let wordIndex = 0; wordIndex < result.length; wordIndex += 1) result[wordIndex] = result[wordIndex]! | allowed[wordIndex]!;
    }
  }
  return result;
}

function propagate(index: IndexedRequest, domains: Map<string, Bits>, assignments: Map<string, number>): boolean {
  let changed = true;
  while (changed) {
    changed = false;
    for (const intersection of index.intersections) {
      const left = domains.get(intersection.slotId);
      const right = domains.get(intersection.otherSlotId);
      const leftSlot = index.slotById.get(intersection.slotId);
      const rightSlot = index.slotById.get(intersection.otherSlotId);
      if (!left || !right || !leftSlot || !rightSlot) return false;
      const allowedLeft = compatibleBits(
        index,
        leftSlot.length,
        intersection.position,
        intersection.otherPosition,
        right
      );
      const allowedRight = compatibleBits(
        index,
        rightSlot.length,
        intersection.otherPosition,
        intersection.position,
        left
      );
      changed ||= intersectInto(left, allowedLeft);
      changed ||= intersectInto(right, allowedRight);
      if (bitCount(left) === 0 || bitCount(right) === 0) return false;
    }

    for (const [slotId, candidateIndex] of assignments) {
      const candidate = index.candidates[candidateIndex]!;
      for (const slot of index.slots) {
        if (slot.id === slotId) continue;
        const domain = domains.get(slot.id);
        if (!domain) return false;
        for (const otherIndex of candidateIndexes(domain)) {
          if (index.candidates[otherIndex]!.normalizedWord === candidate.normalizedWord) changed ||= removeBit(domain, otherIndex);
        }
        if (bitCount(domain) === 0) return false;
      }
    }
  }
  return true;
}

function selectSlot(index: IndexedRequest, domains: Map<string, Bits>, assignments: Map<string, number>): FillSlot | undefined {
  return index.slots
    .filter((slot) => !assignments.has(slot.id))
    .sort((left, right) => {
      const sizeDelta = bitCount(domains.get(left.id)!) - bitCount(domains.get(right.id)!);
      if (sizeDelta !== 0) return sizeDelta;
      const pressureDelta = (index.intersectionsBySlot.get(right.id)?.length ?? 0) - (index.intersectionsBySlot.get(left.id)?.length ?? 0);
      return pressureDelta || left.id.localeCompare(right.id);
    })[0];
}

function remainingScoreUpperBound(index: IndexedRequest, domains: Map<string, Bits>, assignments: Map<string, number>): number {
  let bound = 0;
  for (const slot of index.slots) {
    if (assignments.has(slot.id)) continue;
    const domain = domains.get(slot.id);
    if (!domain) return Number.NEGATIVE_INFINITY;
    const best = candidateIndexes(domain)
      .map((candidateIndex) => index.candidates[candidateIndex]?.score ?? Number.NEGATIVE_INFINITY)
      .reduce((maximum, score) => Math.max(maximum, score), Number.NEGATIVE_INFINITY);
    if (best === Number.NEGATIVE_INFINITY) return best;
    bound += best;
  }
  return bound;
}

export function solveFill(request: FillRequest, options: FillOptions = {}): FillResult {
  const indexed = createIndex(request);
  if ('failure' in indexed) return { status: 'failed', failure: indexed.failure };
  const maxNodes = request.maxNodes ?? 50_000;
  const seed = request.seed ?? 0;
  let nodes = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  let best: FillSolution | undefined;

  const search = (domains: Map<string, Bits>, assignments: Map<string, number>, score: number): boolean => {
    nodes += 1;
    if (options.signal?.aborted) return false;
    if (nodes > maxNodes) return false;
    if (best && score + remainingScoreUpperBound(indexed, domains, assignments) <= bestScore) return false;
    const slot = selectSlot(indexed, domains, assignments);
    options.onProgress?.({ type: 'progress', nodes, assigned: assignments.size, openSlots: indexed.slots.length - assignments.size, bestScore });
    if (!slot) {
      if (score >= (request.qualityThreshold ?? Number.NEGATIVE_INFINITY)) {
        const result: Record<string, FillCandidate> = {};
        for (const [slotId, candidateIndex] of assignments) result[slotId] = indexed.candidates[candidateIndex]!;
        if (!best || score > bestScore) {
          best = { assignments: result, score, nodes };
          bestScore = score;
        }
      }
      return false;
    }

    const values = candidateIndexes(domains.get(slot.id)!)
      .sort((left, right) => {
        const leftCandidate = indexed.candidates[left]!;
        const rightCandidate = indexed.candidates[right]!;
        return rightCandidate.score - leftCandidate.score
          || seededTieBreak(seed, leftCandidate.normalizedWord) - seededTieBreak(seed, rightCandidate.normalizedWord);
      });
    for (const candidateIndex of values) {
      if (options.signal?.aborted) return false;
      const nextDomains = new Map([...domains].map(([id, domain]) => [id, cloneBits(domain)] as const));
      const nextAssignments = new Map(assignments).set(slot.id, candidateIndex);
      nextDomains.set(slot.id, new Uint32Array(nextDomains.get(slot.id)!.length));
      const selectedDomain = nextDomains.get(slot.id)!;
      selectedDomain[candidateIndex >>> 5] = selectedDomain[candidateIndex >>> 5]! | (1 << (candidateIndex & 31));
      if (propagate(indexed, nextDomains, nextAssignments)) search(nextDomains, nextAssignments, score + indexed.candidates[candidateIndex]!.score);
      if (nodes > maxNodes) return false;
    }
    return false;
  };

  const domains = new Map(indexed.slots.map((slot) => [slot.id, initialDomain(indexed, slot)] as const));
  if (!propagate(indexed, domains, new Map())) return { status: 'failed', failure: { code: 'unsatisfiable', message: 'Initial crossing constraints have no solution', nodes } };
  search(domains, new Map(), 0);
  if (best) return { status: 'solved', solution: best };
  const code: FillFailureCode = options.signal?.aborted ? 'cancelled' : nodes > maxNodes ? 'resource-limit' : 'unsatisfiable';
  return { status: 'failed', failure: { code, message: code === 'cancelled' ? 'Fill search cancelled' : code === 'resource-limit' ? 'Fill search reached its node budget' : 'No valid fill satisfies the constraints', nodes } };
}

function yieldToHost(): Promise<void> {
  const host = globalThis as typeof globalThis & { setTimeout?: (callback: () => void, delayMs: number) => unknown };
  return typeof host.setTimeout === 'function'
    ? new Promise((resolve) => host.setTimeout!(resolve, 0))
    : Promise.resolve();
}

export async function solveFillAsync(request: FillRequest, options: FillOptions = {}): Promise<FillResult> {
  const indexed = createIndex(request);
  if ('failure' in indexed) return { status: 'failed', failure: indexed.failure };
  const maxNodes = request.maxNodes ?? 50_000;
  const seed = request.seed ?? 0;
  let nodes = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  let best: FillSolution | undefined;

  const search = async (domains: Map<string, Bits>, assignments: Map<string, number>, score: number): Promise<boolean> => {
    nodes += 1;
    if (nodes % 32 === 0) await yieldToHost();
    if (options.signal?.aborted || nodes > maxNodes) return false;
    if (best && score + remainingScoreUpperBound(indexed, domains, assignments) <= bestScore) return false;
    const slot = selectSlot(indexed, domains, assignments);
    options.onProgress?.({ type: 'progress', nodes, assigned: assignments.size, openSlots: indexed.slots.length - assignments.size, bestScore });
    if (!slot) {
      if (score >= (request.qualityThreshold ?? Number.NEGATIVE_INFINITY)) {
        const result: Record<string, FillCandidate> = {};
        for (const [slotId, candidateIndex] of assignments) result[slotId] = indexed.candidates[candidateIndex]!;
        if (!best || score > bestScore) {
          best = { assignments: result, score, nodes };
          bestScore = score;
        }
      }
      return false;
    }

    const values = candidateIndexes(domains.get(slot.id)!)
      .sort((left, right) => {
        const leftCandidate = indexed.candidates[left]!;
        const rightCandidate = indexed.candidates[right]!;
        return rightCandidate.score - leftCandidate.score
          || seededTieBreak(seed, leftCandidate.normalizedWord) - seededTieBreak(seed, rightCandidate.normalizedWord);
      });
    for (const candidateIndex of values) {
      if (options.signal?.aborted) return false;
      const nextDomains = new Map([...domains].map(([id, domain]) => [id, cloneBits(domain)] as const));
      const nextAssignments = new Map(assignments).set(slot.id, candidateIndex);
      nextDomains.set(slot.id, new Uint32Array(nextDomains.get(slot.id)!.length));
      const selectedDomain = nextDomains.get(slot.id)!;
      selectedDomain[candidateIndex >>> 5] = selectedDomain[candidateIndex >>> 5]! | (1 << (candidateIndex & 31));
      if (propagate(indexed, nextDomains, nextAssignments)) await search(nextDomains, nextAssignments, score + indexed.candidates[candidateIndex]!.score);
      if (nodes > maxNodes) return false;
    }
    return false;
  };

  const domains = new Map(indexed.slots.map((slot) => [slot.id, initialDomain(indexed, slot)] as const));
  if (!propagate(indexed, domains, new Map())) return { status: 'failed', failure: { code: 'unsatisfiable', message: 'Initial crossing constraints have no solution', nodes } };
  await search(domains, new Map(), 0);
  if (best) return { status: 'solved', solution: best };
  const code: FillFailureCode = options.signal?.aborted ? 'cancelled' : nodes > maxNodes ? 'resource-limit' : 'unsatisfiable';
  return { status: 'failed', failure: { code, message: code === 'cancelled' ? 'Fill search cancelled' : code === 'resource-limit' ? 'Fill search reached its node budget' : 'No valid fill satisfies the constraints', nodes } };
}
