import { solveFill, type FillCandidate, type FillRequest } from '@crossword/construction';
import type { CandidateRequest, ModelBroker, CandidateSuggestion } from '@crossword/model-runtime';
import { describe, expect, it } from 'vitest';
import { constructOriginalFill, generateCandidateBatches, type LexiconResolver } from './constructionUseCases';

const modelRequest: CandidateRequest = {
  seed: 'fixture',
  audienceSummary: 'broad',
  requestedRoles: ['general'],
  excludedAnswers: [],
  maxSuggestions: 4
};

const fillRequest: Omit<FillRequest, 'candidates'> = {
  slots: [{ id: 'slot', length: 3 }],
  intersections: []
};

const suggestion: CandidateSuggestion = {
  surface: 'CAT',
  intendedSense: 'a small animal',
  associations: ['pet'],
  role: 'general',
  confidence: 0.8
};

const candidate: FillCandidate = {
  word: 'CAT',
  score: 1,
  lexemeId: 'lexeme-cat',
  sourceIds: ['fixture']
};

function brokerWith(output: unknown): ModelBroker {
  return {
    state: () => 'loaded',
    probe: () => ({ webgpu: true, availableMemoryMb: 1, storageQuotaBytes: 1, storageUsageBytes: 0 }),
    install: async () => ({ ok: true, value: undefined }),
    load: async () => ({ ok: true, value: undefined }),
    generateCandidates: async () => ({ ok: true, value: output as readonly CandidateSuggestion[] }),
    composeClues: async () => ({ ok: true, value: [] }),
    unload: async () => ({ ok: true, value: undefined })
  };
}

const resolver: LexiconResolver = {
  resolve: (value) => value.surface === 'CAT' ? candidate : undefined
};

describe('original construction use case', () => {
  it('generates bounded batches with deterministic seeds and evolving exclusions', async () => {
    const requests: CandidateRequest[] = [];
    const broker: ModelBroker = {
      ...brokerWith([]),
      generateCandidates: async (request) => {
        requests.push(request);
        return {
          ok: true,
          value: [{
            ...suggestion,
            surface: requests.length === 1 ? 'CAT' : 'DOG'
          }]
        };
      }
    };

    const result = await generateCandidateBatches(broker, {
      ...modelRequest,
      focus: 'long answers about coastal ecology',
      targetLengths: [10, 11, 12, 13, 14, 15]
    }, 2);

    expect(result.ok).toBe(true);
    expect(requests.map((request) => request.seed)).toEqual(['fixture:batch-1', 'fixture:batch-2']);
    expect(requests[1]?.excludedAnswers).toContain('CAT');
    expect(result.ok && result.value.map((value) => value.surface)).toEqual(['CAT', 'DOG']);
  });

  it('rejects an unbounded batch request before calling the model', async () => {
    const calls: string[] = [];
    const broker: ModelBroker = {
      ...brokerWith([]),
      generateCandidates: async () => {
        calls.push('generate');
        return { ok: true, value: [] };
      }
    };

    const result = await generateCandidateBatches(broker, modelRequest, 9);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid-model-output',
        message: 'Candidate batch count must be an integer from 1 to 8'
      }
    });
    expect(calls).toEqual([]);
  });

  it('requires accepted lexicon resolution before deterministic fill', async () => {
    const result = await constructOriginalFill(
      brokerWith([suggestion]),
      resolver,
      { solve: (request, options) => solveFill(request, options) },
      { model: modelRequest, fill: fillRequest }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedCandidateCount).toBe(1);
      expect(result.solution.assignments.slot?.lexemeId).toBe('lexeme-cat');
    }
  });

  it('rejects model suggestions that the lexicon cannot resolve', async () => {
    const result = await constructOriginalFill(
      brokerWith([{ ...suggestion, surface: 'UNKNOWN' }]),
      resolver,
      { solve: (request, options) => solveFill(request, options) },
      { model: modelRequest, fill: fillRequest }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        stage: 'lexicon',
        code: 'no-eligible-candidates',
        message: 'The local model produced no candidates accepted by the licensed lexicon'
      }
    });
  });

  it('forwards a disabled-model result without invoking the fill engine', async () => {
    const calls: string[] = [];
    const broker: ModelBroker = {
      ...brokerWith([]),
      generateCandidates: async () => ({ ok: false, error: { code: 'model-not-enabled', message: 'Install the local model' } })
    };

    const result = await constructOriginalFill(
      broker,
      resolver,
      { solve: () => { calls.push('solve'); return solveFill({ ...fillRequest, candidates: [candidate] }); } },
      { model: modelRequest, fill: fillRequest }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ stage: 'model', code: 'model-not-enabled' });
    expect(calls).toEqual([]);
  });
});
