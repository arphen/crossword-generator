import type {
  FillCandidate,
  FillOptions,
  FillRequest,
  FillResult,
  FillSolution
} from '@crossword/construction';
import type {
  BrokerResult,
  CandidateRequest,
  CandidateSuggestion,
  ModelBroker,
  ModelFailureCode
} from '@crossword/model-runtime';

export interface LexiconResolver {
  resolve: (suggestion: CandidateSuggestion) => FillCandidate | undefined;
}

export interface FillGrid {
  solve: (request: FillRequest, options?: FillOptions) => FillResult | Promise<FillResult>;
}

export type OriginalConstructionRequest = Readonly<{
  model: CandidateRequest;
  fill: Omit<FillRequest, 'candidates'>;
  candidateBatches?: number;
}>;

export type ConstructionFailure = Readonly<{
  stage: 'model' | 'lexicon' | 'fill';
  code: ModelFailureCode | 'no-eligible-candidates' | 'unsatisfiable' | 'cancelled' | 'resource-limit' | 'invalid-request';
  message: string;
}>;

export type OriginalConstructionResult = Readonly<
  | { ok: true; solution: FillSolution; resolvedCandidateCount: number }
  | { ok: false; error: ConstructionFailure }
>;

const MAX_CANDIDATE_BATCHES = 8;

function batchCount(value: number | undefined): number | undefined {
  const count = value ?? 1;
  return Number.isInteger(count) && count >= 1 && count <= MAX_CANDIDATE_BATCHES ? count : undefined;
}

export async function generateCandidateBatches(
  broker: ModelBroker,
  request: CandidateRequest,
  requestedBatches = 1,
  signal?: AbortSignal
): Promise<BrokerResult<readonly CandidateSuggestion[]>> {
  const count = batchCount(requestedBatches);
  if (count === undefined) return {
    ok: false,
    error: {
      code: 'invalid-model-output',
      message: `Candidate batch count must be an integer from 1 to ${MAX_CANDIDATE_BATCHES}`
    }
  };

  const suggestions: CandidateSuggestion[] = [];
  const excludedAnswers = [...request.excludedAnswers];
  for (let batch = 0; batch < count; batch += 1) {
    const generated = await broker.generateCandidates({
      ...request,
      seed: `${request.seed}:batch-${batch + 1}`,
      excludedAnswers
    }, signal);
    if (!generated.ok) return generated;
    suggestions.push(...generated.value);
    excludedAnswers.push(...generated.value.map((suggestion) => suggestion.surface));
  }
  return { ok: true, value: suggestions };
}

export async function constructOriginalFill(
  broker: ModelBroker,
  resolver: LexiconResolver,
  fillGrid: FillGrid,
  request: OriginalConstructionRequest,
  signal?: AbortSignal
): Promise<OriginalConstructionResult> {
  const generated = await generateCandidateBatches(broker, request.model, request.candidateBatches, signal);
  if (!generated.ok) return { ok: false, error: { stage: 'model', ...generated.error } };

  const candidates = generated.value
    .map((suggestion) => resolver.resolve(suggestion))
    .filter((candidate): candidate is FillCandidate => candidate !== undefined);
  if (candidates.length === 0) return {
    ok: false,
    error: {
      stage: 'lexicon',
      code: 'no-eligible-candidates',
      message: 'The local model produced no candidates accepted by the licensed lexicon'
    }
  };

  const filled = await fillGrid.solve({ ...request.fill, candidates }, { signal });
  if (filled.status === 'solved' && filled.solution) return { ok: true, solution: filled.solution, resolvedCandidateCount: candidates.length };
  const failure = filled.failure;
  return {
    ok: false,
    error: {
      stage: 'fill',
      code: failure?.code ?? 'unsatisfiable',
      message: failure?.message ?? 'The deterministic fill engine rejected the candidate set'
    }
  };
}
