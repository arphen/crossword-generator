import type {
  FillCandidate,
  FillIntersection,
  FillRequest,
  FillSolution,
} from '@crossword/construction';
import type {
  CandidateRole,
  CandidateSuggestion,
  ClueDraft,
  ModelBroker,
} from '@crossword/model-runtime';
import {
  createFakeLocalModelAdapter,
  createModelBroker,
} from '@crossword/model-runtime';

export type LabSourceLabel = 'fixture' | 'model suggestion' | 'owner supplied';
export type LabDirection = 'across' | 'down';

export type LabCell = Readonly<{
  row: number;
  column: number;
  acrossSlotId: string;
  downSlotId: string;
}>;

export type LabSlotGeometry = Readonly<{
  slotId: string;
  row: number;
  column: number;
  direction: LabDirection;
  length: number;
  cells: readonly LabCell[];
}>;

export type LabTemplate = Readonly<{
  id: 'mini-3x3-crossing';
  version: 1;
  width: 3;
  height: 3;
  slots: readonly LabSlotGeometry[];
  intersections: readonly FillIntersection[];
  fill: Omit<FillRequest, 'candidates'>;
}>;

export type FixtureLexiconEntry = Readonly<{
  answer: string;
  lexemeId: string;
  senseId: string;
  intendedSense: string;
  score: number;
  tags: readonly string[];
}>;

export type CandidateDecision = Readonly<{
  suggestion: CandidateSuggestion;
  normalizedAnswer: string;
  accepted: boolean;
  reason:
    | 'accepted'
    | 'not-in-fixture-lexicon'
    | 'duplicate-answer'
    | 'invalid-surface';
  source: LabSourceLabel;
  candidate?: FillCandidate;
}>;

const fixtureEntries: readonly FixtureLexiconEntry[] = [
  {
    answer: 'CAT',
    lexemeId: 'fixture-cat',
    senseId: 'fixture-cat-animal',
    intendedSense: 'a small domesticated feline',
    score: 0.96,
    tags: ['animal', 'synthetic'],
  },
  {
    answer: 'ORE',
    lexemeId: 'fixture-ore',
    senseId: 'fixture-ore-mineral',
    intendedSense: 'rock containing a useful mineral',
    score: 0.88,
    tags: ['geology', 'synthetic'],
  },
  {
    answer: 'PEN',
    lexemeId: 'fixture-pen',
    senseId: 'fixture-pen-writing',
    intendedSense: 'a small instrument for writing',
    score: 0.9,
    tags: ['writing', 'synthetic'],
  },
  {
    answer: 'COP',
    lexemeId: 'fixture-cop',
    senseId: 'fixture-cop-officer',
    intendedSense: 'a police officer in informal language',
    score: 0.87,
    tags: ['person', 'synthetic'],
  },
  {
    answer: 'ARE',
    lexemeId: 'fixture-are-verb',
    senseId: 'fixture-are-verb',
    intendedSense: 'present-tense form of the verb be',
    score: 0.86,
    tags: ['grammar', 'synthetic'],
  },
  {
    answer: 'TEN',
    lexemeId: 'fixture-ten-number',
    senseId: 'fixture-ten-number',
    intendedSense: 'the number after nine',
    score: 0.84,
    tags: ['number', 'synthetic'],
  },
  {
    answer: 'CAR',
    lexemeId: 'fixture-car-decoy',
    senseId: 'fixture-car-vehicle',
    intendedSense: 'a road vehicle; deliberate search decoy',
    score: 0.25,
    tags: ['decoy', 'synthetic'],
  },
];

export const FIXTURE_LEXICON = fixtureEntries;

const suggestion = (
  surface: string,
  role: CandidateRole,
  intendedSense: string,
  confidence: number,
): CandidateSuggestion => ({
  surface,
  intendedSense,
  associations: ['synthetic fixture'],
  role,
  confidence,
});

/**
 * All words and clue text here are synthetic lab data. They are deliberately
 * not a licensed lexicon or editorial corpus and must never be treated as a
 * publishable puzzle source.
 */
export const FIXTURE_SUGGESTIONS: readonly CandidateSuggestion[] = [
  suggestion('CAT', 'general', 'a small domesticated feline', 0.96),
  suggestion('ORE', 'general', 'rock containing a useful mineral', 0.88),
  suggestion('PEN', 'general', 'a small instrument for writing', 0.9),
  suggestion('COP', 'general', 'a police officer in informal language', 0.87),
  suggestion('ARE', 'glue', 'present-tense form of the verb be', 0.86),
  suggestion('TEN', 'general', 'the number after nine', 0.84),
  suggestion('CAR', 'stretch', 'a road vehicle; deliberate decoy', 0.25),
  suggestion('UNLISTED', 'stretch', 'deliberate rejection example', 0.7),
];

export const FIXTURE_CLUES: readonly ClueDraft[] = [
  {
    mechanism: 'direct',
    text: 'Small feline, in a synthetic lab clue',
    difficulty: 0.1,
  },
  {
    mechanism: 'standard',
    text: 'Mineral-bearing rock, experimentally',
    difficulty: 0.25,
  },
  {
    mechanism: 'direct',
    text: "Writer's small tool, synthetic draft",
    difficulty: 0.2,
  },
];

function slot(
  slotId: string,
  row: number,
  column: number,
  direction: LabDirection,
): LabSlotGeometry {
  const cells: LabCell[] = [];
  for (let offset = 0; offset < 3; offset += 1) {
    const cellRow = direction === 'across' ? row : row + offset;
    const cellColumn = direction === 'across' ? column + offset : column;
    cells.push({
      row: cellRow,
      column: cellColumn,
      acrossSlotId: `A${cellRow + 1}`,
      downSlotId: `D${cellColumn + 1}`,
    });
  }
  return { slotId, row, column, direction, length: 3, cells };
}

const across = [
  slot('A1', 0, 0, 'across'),
  slot('A2', 1, 0, 'across'),
  slot('A3', 2, 0, 'across'),
];
const down = [
  slot('D1', 0, 0, 'down'),
  slot('D2', 0, 1, 'down'),
  slot('D3', 0, 2, 'down'),
];

const intersections: FillIntersection[] = [];
for (const [row, acrossSlot] of across.entries()) {
  for (const [column, downSlot] of down.entries()) {
    intersections.push({
      slotId: acrossSlot.slotId,
      position: column,
      otherSlotId: downSlot.slotId,
      otherPosition: row,
    });
  }
}

export const MINI_TEMPLATE: LabTemplate = {
  id: 'mini-3x3-crossing',
  version: 1,
  width: 3,
  height: 3,
  slots: [...across, ...down],
  intersections,
  fill: {
    slots: [...across, ...down].map((item) => ({
      id: item.slotId,
      length: item.length,
    })),
    intersections,
  },
};

export function getFixtureEntry(
  answer: string,
): FixtureLexiconEntry | undefined {
  const normalized = answer.trim().toUpperCase();
  return fixtureEntries.find((entry) => entry.answer === normalized);
}

function normalizeSurface(surface: string): string {
  return surface.trim().toUpperCase();
}

export function candidateFromEntry(
  entry: FixtureLexiconEntry,
  source: LabSourceLabel = 'fixture',
): FillCandidate {
  const sourceIds =
    source === 'fixture'
      ? ['fixture-lexicon']
      : source === 'model suggestion'
        ? ['model-suggestion', 'fixture-lexicon']
        : ['owner-supplied'];
  return {
    word: entry.answer,
    score: entry.score,
    lexemeId: entry.lexemeId,
    senseId: entry.senseId,
    sourceIds,
    tags: [...entry.tags, source],
  };
}

export function resolveSuggestion(
  suggestionValue: CandidateSuggestion,
  source: LabSourceLabel = 'fixture',
  acceptedAnswers: ReadonlySet<string> = new Set(),
): CandidateDecision {
  const normalizedAnswer = normalizeSurface(suggestionValue.surface);
  if (!/^[A-Z]+$/.test(normalizedAnswer))
    return {
      suggestion: suggestionValue,
      normalizedAnswer,
      accepted: false,
      reason: 'invalid-surface',
      source,
    };
  if (acceptedAnswers.has(normalizedAnswer))
    return {
      suggestion: suggestionValue,
      normalizedAnswer,
      accepted: false,
      reason: 'duplicate-answer',
      source,
    };
  if (source === 'owner supplied')
    return {
      suggestion: suggestionValue,
      normalizedAnswer,
      accepted: true,
      reason: 'accepted',
      source,
      candidate: {
        word: normalizedAnswer,
        score: 1,
        lexemeId: `owner-${normalizedAnswer.toLowerCase()}`,
        senseId: 'owner-supplied-ephemeral',
        sourceIds: ['owner-supplied'],
        tags: ['manual', 'ephemeral'],
      },
    };
  const entry = getFixtureEntry(normalizedAnswer);
  if (!entry)
    return {
      suggestion: suggestionValue,
      normalizedAnswer,
      accepted: false,
      reason: 'not-in-fixture-lexicon',
      source,
    };
  return {
    suggestion: suggestionValue,
    normalizedAnswer,
    accepted: true,
    reason: 'accepted',
    source,
    candidate: candidateFromEntry(entry, source),
  };
}

export function manualSuggestion(surface: string): CandidateSuggestion {
  return suggestion(
    surface,
    'general',
    'Owner-supplied ephemeral candidate',
    1,
  );
}

export function createFixtureBroker(): ModelBroker {
  return createModelBroker(
    {
      schemaVersion: 1,
      id: 'fixture-simulated-model',
      version: '1.0.0',
      quantization: 'none',
      runtimeVersion: 'fixture-runtime',
      promptVersion: 'fixture-v1',
      minimumMemoryMb: 1,
      shards: [],
      distribution: 'webllm-mlc',
    },
    createFakeLocalModelAdapter({
      suggestions: FIXTURE_SUGGESTIONS,
      clueDrafts: ({ answer }) =>
        FIXTURE_CLUES.slice(0, 1).map((draft) => ({
          ...draft,
          text: `${draft.text}: ${answer}`,
        })),
    }),
    {
      webgpu: true,
      availableMemoryMb: 8192,
      storageQuotaBytes: 1,
      storageUsageBytes: 0,
    },
  );
}

export type ProjectedCell = Readonly<{
  letter?: string;
  acrossSlotId: string;
  downSlotId: string;
  acrossWord?: string;
  downWord?: string;
  consistent: boolean;
}>;

export type ProjectedGrid = readonly (readonly ProjectedCell[])[];

export function projectSolutionToGrid(solution: FillSolution): ProjectedGrid {
  return Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, column) => {
      const acrossSlotId = `A${row + 1}`;
      const downSlotId = `D${column + 1}`;
      const acrossWord = solution.assignments[acrossSlotId]?.word
        .trim()
        .toUpperCase();
      const downWord = solution.assignments[downSlotId]?.word
        .trim()
        .toUpperCase();
      const acrossLetter = acrossWord?.[column];
      const downLetter = downWord?.[row];
      return {
        letter: acrossLetter ?? downLetter,
        acrossSlotId,
        downSlotId,
        acrossWord,
        downWord,
        consistent:
          acrossLetter === undefined ||
          downLetter === undefined ||
          acrossLetter === downLetter,
      };
    }),
  );
}

export function fixtureCrossingWords(): Readonly<Record<string, string>> {
  return { A1: 'CAT', A2: 'ORE', A3: 'PEN', D1: 'COP', D2: 'ARE', D3: 'TEN' };
}
