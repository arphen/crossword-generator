import type {
  CandidateRequest,
  CandidateSuggestion,
  ClueDraft,
  LocalModelAdapter,
} from './broker';

export type FakeLocalModelAdapter = LocalModelAdapter &
  Readonly<{
    calls: Readonly<{
      install: () => number;
      load: () => number;
      unload: () => number;
    }>;
  }>;

export type FakeLocalModelAdapterOptions = Readonly<{
  suggestions?: readonly CandidateSuggestion[];
  clueDrafts?:
    | readonly ClueDraft[]
    | ((
        request: Readonly<{ answer: string; intendedSense: string }>,
      ) => readonly ClueDraft[]);
}>;

/**
 * Deterministic adapter for tests and harness runs: no network, no weights,
 * no randomness. Mirrors the real adapter contract, including the
 * "not loaded" guard after unload.
 */
export function createFakeLocalModelAdapter(
  output: FakeLocalModelAdapterOptions = {},
): FakeLocalModelAdapter {
  const counters = { install: 0, load: 0, unload: 0 };
  let unloaded = false;

  const requireLoaded = () => {
    if (unloaded) throw new Error('Local model is not loaded');
  };

  return {
    calls: {
      install: () => counters.install,
      load: () => counters.load,
      unload: () => counters.unload,
    },
    async install() {
      counters.install += 1;
    },
    async load() {
      counters.load += 1;
      unloaded = false;
    },
    async generateCandidates(request: CandidateRequest) {
      requireLoaded();
      if (output.suggestions)
        return output.suggestions
          .filter(
            (item) =>
              !request.excludedAnswers.some(
                (excluded) =>
                  excluded.trim().toUpperCase() ===
                  item.surface.trim().toUpperCase(),
              ),
          )
          .slice(0, request.maxSuggestions);
      const role = request.requestedRoles[0] ?? 'general';
      return Array.from(
        { length: Math.min(request.maxSuggestions, 3) },
        (_, index) => ({
          surface: `FAKEWORD${index + 1}`,
          intendedSense: 'fixture sense',
          associations: [],
          role,
          confidence: 0.5,
        }),
      );
    },
    async composeClues(request) {
      requireLoaded();
      const clueDrafts =
        typeof output.clueDrafts === 'function'
          ? output.clueDrafts(request)
          : output.clueDrafts;
      return clueDrafts
        ? [...clueDrafts]
        : [
            {
              mechanism: 'direct',
              text: `Plain clue for ${request.answer}`,
              difficulty: 0.1,
            },
          ];
    },
    async unload() {
      counters.unload += 1;
      unloaded = true;
    },
  };
}
