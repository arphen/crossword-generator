import { solveFill, type FillCandidate } from '@crossword/construction';
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_LEXICON,
  FIXTURE_SUGGESTIONS,
  MINI_TEMPLATE,
  fixtureCrossingWords,
  getFixtureEntry,
  projectSolutionToGrid,
  resolveSuggestion,
} from './fixture';

describe('mini fixture topology', () => {
  it('contains nine explicit crossings with the expected words', () => {
    expect(MINI_TEMPLATE.intersections).toHaveLength(9);
    expect(fixtureCrossingWords()).toEqual({
      A1: 'CAT',
      A2: 'ORE',
      A3: 'PEN',
      D1: 'COP',
      D2: 'ARE',
      D3: 'TEN',
    });
    for (const intersection of MINI_TEMPLATE.intersections) {
      const left = MINI_TEMPLATE.slots.find(
        (slot) => slot.slotId === intersection.slotId,
      )!;
      const right = MINI_TEMPLATE.slots.find(
        (slot) => slot.slotId === intersection.otherSlotId,
      )!;
      expect(left.cells[intersection.position]?.row).toBe(
        right.cells[intersection.otherPosition]?.row,
      );
      expect(left.cells[intersection.position]?.column).toBe(
        right.cells[intersection.otherPosition]?.column,
      );
    }
  });

  it('projects a solved assignment and flags conflicting cells', () => {
    const assignments = Object.fromEntries(
      Object.entries(fixtureCrossingWords()).map(([slotId, answer]) => [
        slotId,
        {
          word: answer,
          score: 1,
          lexemeId: `fixture-${answer}`,
          sourceIds: ['fixture-lexicon'],
        } satisfies FillCandidate,
      ]),
    );
    const grid = projectSolutionToGrid({ assignments, score: 6, nodes: 1 });
    expect(grid.map((row) => row.map((cell) => cell.letter))).toEqual([
      ['C', 'A', 'T'],
      ['O', 'R', 'E'],
      ['P', 'E', 'N'],
    ]);
    const conflict = projectSolutionToGrid({
      assignments: { ...assignments, D3: { ...assignments.D3!, word: 'CAR' } },
      score: 1,
      nodes: 1,
    });
    expect(conflict[2]?.[2]?.consistent).toBe(false);
  });

  it('rejects an unsatisfiable candidate set instead of displaying a false fill', () => {
    const candidates = fixtureCrossingWords();
    const result = solveFill({
      ...MINI_TEMPLATE.fill,
      candidates: Object.entries(candidates).map(([slotId, word]) => ({
        word: slotId === 'D3' ? 'CAR' : word,
        score: 1,
        lexemeId: `fixture-${slotId}`,
        sourceIds: ['fixture-lexicon'],
      })),
    });
    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('unsatisfiable');
  });

  it('keeps provenance and reports both a rejected suggestion and a decoy', () => {
    const decisions = FIXTURE_SUGGESTIONS.map((item) =>
      resolveSuggestion(item),
    );
    expect(FIXTURE_LEXICON).toHaveLength(7);
    expect(
      decisions.find((item) => item.normalizedAnswer === 'UNLISTED'),
    ).toMatchObject({
      accepted: false,
      reason: 'not-in-fixture-lexicon',
      source: 'fixture',
    });
    expect(
      decisions.find((item) => item.normalizedAnswer === 'CAR'),
    ).toMatchObject({
      accepted: true,
      source: 'fixture',
      candidate: { tags: expect.arrayContaining(['decoy', 'fixture']) },
    });
    expect(getFixtureEntry('cat')?.senseId).toBe('fixture-cat-animal');
    expect(
      resolveSuggestion(
        {
          surface: 'BEE',
          intendedSense: 'owner experiment',
          associations: [],
          role: 'general',
          confidence: 1,
        },
        'owner supplied',
      ),
    ).toMatchObject({
      accepted: true,
      source: 'owner supplied',
      candidate: {
        sourceIds: ['owner-supplied'],
        tags: ['manual', 'ephemeral'],
      },
    });
  });
});
