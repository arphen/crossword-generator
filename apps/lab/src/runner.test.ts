import { solveFillAsync, type FillResult } from '@crossword/construction';
import type { ConstructorWorkerClient } from '@crossword/generator/constructor-client';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECIPE,
  createFixtureBrokerForTests,
  createLabRunner,
  createTestFixtureFillClient,
} from './runner';

function fillClient(): ConstructorWorkerClient {
  return createTestFixtureFillClient((request, options) =>
    solveFillAsync(request, options),
  );
}

describe('lab runner', () => {
  it('runs the fixture end to end with a real deterministic fill', async () => {
    const runner = createLabRunner(DEFAULT_RECIPE, {
      createFixtureModel: createFixtureBrokerForTests,
      createFillClient: fillClient,
      makeId: () => 'run-fixture',
    });
    await runner.runAll();
    const state = runner.snapshot();
    expect(
      Object.values(state.stages).every((stage) => stage.status === 'passed'),
    ).toBe(true);
    expect(state.grid?.map((row) => row.map((cell) => cell.letter))).toEqual([
      ['C', 'A', 'T'],
      ['O', 'R', 'E'],
      ['P', 'E', 'N'],
    ]);
    expect(
      state.candidateDecisions.some(
        (decision) => decision.reason === 'not-in-fixture-lexicon',
      ),
    ).toBe(true);
    expect(
      state.candidateDecisions.some(
        (decision) => decision.normalizedAnswer === 'CAR' && decision.accepted,
      ),
    ).toBe(true);
    expect(state.clues).toHaveLength(6);
    expect(state.events.some((event) => event.kind === 'assignment')).toBe(
      true,
    );
    expect(runner.exportReport().caveats).toContain(
      'This is an experimental mini fill, not a validated daily puzzle.',
    );
    runner.dispose();
  });

  it('stops downstream stages at a resource-limit failure', async () => {
    const runner = createLabRunner(
      { ...DEFAULT_RECIPE, nodeBudget: 1 },
      { createFillClient: fillClient },
    );
    await runner.runAll();
    const state = runner.snapshot();
    expect(state.stages.fill.status).toBe('failed');
    expect(state.stages.fill.failure?.code).toBe('resource-limit');
    expect(state.stages.clues.status).toBe('idle');
    expect(state.stages.review.status).toBe('idle');
    runner.dispose();
  });

  it('records actual cancellation at the stage boundary', async () => {
    let resolveFill: ((result: FillResult) => void) | undefined;
    const slowClient: ConstructorWorkerClient = createTestFixtureFillClient(
      (_request, options) =>
        new Promise((resolve) => {
          resolveFill = resolve;
          options?.signal?.addEventListener('abort', () =>
            resolve({
              status: 'failed',
              failure: {
                code: 'cancelled',
                message: 'Fill search cancelled',
                nodes: 0,
              },
            }),
          );
        }),
    );
    const runner = createLabRunner(DEFAULT_RECIPE, {
      createFillClient: () => slowClient,
    });
    await runner.runNext();
    await runner.runNext();
    await runner.runNext();
    const fillPromise = runner.runNext();
    expect(runner.snapshot().currentStage).toBe('fill');
    runner.cancel();
    await fillPromise;
    expect(runner.snapshot().stages.fill.status).toBe('cancelled');
    expect(resolveFill).toBeDefined();
    runner.dispose();
  });

  it('keeps the prior run as historical evidence when a recipe is reset', async () => {
    const runner = createLabRunner(DEFAULT_RECIPE, {
      createFillClient: fillClient,
      makeId: (() => {
        let n = 0;
        return () => `run-${++n}`;
      })(),
    });
    await runner.runNext();
    runner.reset({ ...DEFAULT_RECIPE, seed: 'different-seed' });
    expect(runner.snapshot().historical?.runId).toBe('run-1');
    expect(runner.snapshot().recipe.seed).toBe('different-seed');
    expect(runner.snapshot().stages.prepare.status).toBe('idle');
    runner.dispose();
  });
});
