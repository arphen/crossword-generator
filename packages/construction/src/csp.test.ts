import { describe, expect, it } from 'vitest';
import { solveFill, solveFillAsync, type FillCandidate, type FillRequest } from './csp';

const candidate = (word: string, score: number): FillCandidate => ({
  word,
  score,
  lexemeId: `lexeme-${word}`,
  sourceIds: ['fixture']
});

function crossingRequest(): FillRequest {
  return {
    seed: 11,
    slots: [
      { id: 'across', length: 3, pattern: 'C..', importance: 1 },
      { id: 'down', length: 3, pattern: '..T', importance: 1 }
    ],
    intersections: [{ slotId: 'across', position: 2, otherSlotId: 'down', otherPosition: 2 }],
    candidates: [candidate('CAT', 3), candidate('COT', 1), candidate('EAT', 2), candidate('OAT', 0.5)]
  };
}

describe('deterministic fill CSP', () => {
  it('propagates crossings and returns the highest ordered valid fill', () => {
    const result = solveFill(crossingRequest());

    expect(result.status).toBe('solved');
    if (result.status !== 'solved' || !result.solution) return;
    expect(result.solution.assignments.across?.word).toBe('CAT');
    expect(result.solution.assignments.down?.word).toBe('EAT');
    expect(result.solution.score).toBe(5);
  });

  it('continues past the first valid fill to maximize total score', () => {
    const result = solveFill({
      slots: [{ id: 'left', length: 3 }, { id: 'right', length: 4 }],
      intersections: [{ slotId: 'left', position: 0, otherSlotId: 'right', otherPosition: 0 }],
      candidates: [
        candidate('AAA', 100),
        candidate('BBB', 1),
        candidate('AADD', 0),
        candidate('BCCC', 100)
      ]
    });

    expect(result.status).toBe('solved');
    if (result.status !== 'solved' || !result.solution) return;
    expect(result.solution.assignments.left?.word).toBe('BBB');
    expect(result.solution.assignments.right?.word).toBe('BCCC');
    expect(result.solution.score).toBe(101);
  });

  it('propagates crossings whose positions differ on the two slots', () => {
    const result = solveFill({
      slots: [
        { id: 'across', length: 3, pattern: 'C..' },
        { id: 'down', length: 4, pattern: '..A.' }
      ],
      intersections: [
        { slotId: 'across', position: 1, otherSlotId: 'down', otherPosition: 2 }
      ],
      candidates: [
        candidate('CAT', 3),
        candidate('COT', 2),
        candidate('BEAR', 4),
        candidate('BOAT', 1)
      ]
    });

    expect(result.status).toBe('solved');
    if (result.status !== 'solved' || !result.solution) return;
    expect(result.solution.assignments.across?.word).toBe('CAT');
    expect(result.solution.assignments.down?.word).toBe('BEAR');
  });

  it('enforces all-different words and excludes recent answers', () => {
    const result = solveFill({
      slots: [{ id: 'one', length: 3 }, { id: 'two', length: 3 }],
      intersections: [],
      candidates: [candidate('CAT', 2), candidate('DOG', 1)],
      excludedWords: ['CAT']
    });

    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('unsatisfiable');
  });

  it.each([
    {
      name: 'empty slot set',
      slots: [],
      intersections: []
    },
    {
      name: 'duplicate slot id',
      slots: [{ id: 'same', length: 3 }, { id: 'same', length: 3 }],
      intersections: []
    },
    {
      name: 'non-positive slot length',
      slots: [{ id: 'bad', length: 0 }],
      intersections: []
    },
    {
      name: 'malformed slot pattern',
      slots: [{ id: 'bad', length: 3, pattern: 'A#.' }],
      intersections: []
    },
    {
      name: 'unknown intersection slot',
      slots: [{ id: 'known', length: 3 }],
      intersections: [
        { slotId: 'known', position: 0, otherSlotId: 'missing', otherPosition: 0 }
      ]
    },
    {
      name: 'out-of-range intersection position',
      slots: [{ id: 'left', length: 3 }, { id: 'right', length: 3 }],
      intersections: [
        { slotId: 'left', position: 3, otherSlotId: 'right', otherPosition: 0 }
      ]
    }
  ])('rejects an invalid request: $name', ({ slots, intersections }) => {
    const result = solveFill({
      slots,
      intersections,
      candidates: [candidate('CAT', 1)]
    });

    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('invalid-request');
    expect(result.failure?.nodes).toBe(0);
  });

  it('normalizes candidates and drops duplicates, exclusions, and invalid metadata', () => {
    const result = solveFill({
      slots: [{ id: 'only', length: 3 }],
      intersections: [],
      excludedWords: ['DOG'],
      candidates: [
        candidate(' cat ', 4),
        candidate('CAT', 100),
        candidate('DOG', 50),
        candidate('A1A', 40),
        { ...candidate('OWL', 30), score: Number.NaN },
        { ...candidate('EMU', 20), lexemeId: '' },
        { ...candidate('YAK', 10), sourceIds: [] }
      ]
    });

    expect(result.status).toBe('solved');
    if (result.status !== 'solved' || !result.solution) return;
    expect(result.solution.assignments.only?.word).toBe(' cat ');
    expect(result.solution.score).toBe(4);
  });

  it('distinguishes a quality threshold from an eligible complete fill', () => {
    const request = {
      slots: [{ id: 'only', length: 3 }],
      intersections: [],
      candidates: [candidate('CAT', 4)]
    } satisfies FillRequest;

    expect(solveFill({ ...request, qualityThreshold: 4 }).status).toBe('solved');
    const belowThreshold = solveFill({ ...request, qualityThreshold: 5 });
    expect(belowThreshold.status).toBe('failed');
    expect(belowThreshold.failure?.code).toBe('unsatisfiable');
  });

  it('reports unsatisfiable topology and cancellation distinctly', () => {
    const unsatisfiable = solveFill({
      slots: [
        { id: 'left', length: 3, pattern: 'C..' },
        { id: 'right', length: 3, pattern: 'D..' }
      ],
      intersections: [{ slotId: 'left', position: 0, otherSlotId: 'right', otherPosition: 0 }],
      candidates: [candidate('CAT', 1), candidate('DOG', 1)]
    });
    expect(unsatisfiable.status).toBe('failed');
    expect(unsatisfiable.failure?.code).toBe('unsatisfiable');

    const controller = new AbortController();
    controller.abort();
    const cancelled = solveFill(crossingRequest(), { signal: controller.signal });
    expect(cancelled.status).toBe('failed');
    expect(cancelled.failure?.code).toBe('cancelled');
  });

  it('emits bounded progress and honors a node budget', () => {
    const progress: number[] = [];
    const result = solveFill({
      ...crossingRequest(),
      maxNodes: 1
    }, {
      onProgress: (event) => progress.push(event.nodes)
    });

    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('resource-limit');
    expect(progress).toEqual([1]);
  });

  it('allows an async caller to cancel from a progress callback', async () => {
    const controller = new AbortController();
    const result = await solveFillAsync(crossingRequest(), {
      signal: controller.signal,
      onProgress: (event) => {
        if (event.nodes === 1) controller.abort();
      }
    });

    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('cancelled');
  });

  it('keeps async solving behavior aligned with the synchronous engine', async () => {
    const expected = solveFill(crossingRequest());
    const actual = await solveFillAsync(crossingRequest());

    expect(actual).toEqual(expected);

    const invalid = await solveFillAsync({
      slots: [],
      intersections: [],
      candidates: [candidate('CAT', 1)]
    });
    expect(invalid.failure?.code).toBe('invalid-request');
  });
});
