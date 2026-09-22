import { describe, expect, it } from 'vitest';
import type { ModelManifest } from './broker';
import { createFakeLocalModelAdapter } from './fakeAdapter';

const manifest: ModelManifest = {
  schemaVersion: 1,
  id: 'fixture-model',
  version: '1',
  quantization: 'q4f16_1',
  runtimeVersion: 'webllm-fixture',
  promptVersion: 'candidate-v1',
  minimumMemoryMb: 1,
  shards: [],
};

const request = {
  seed: 'fixture',
  audienceSummary: 'broad',
  requestedRoles: ['long'] as const,
  excludedAnswers: [],
  maxSuggestions: 2,
};

describe('deterministic fake model adapter', () => {
  it('derives bounded deterministic suggestions from the request', async () => {
    const adapter = createFakeLocalModelAdapter();
    const result = await adapter.generateCandidates(request);

    expect(result).toHaveLength(2);
    expect(result).toEqual([
      {
        surface: 'FAKEWORD1',
        intendedSense: 'fixture sense',
        associations: [],
        role: 'long',
        confidence: 0.5,
      },
      {
        surface: 'FAKEWORD2',
        intendedSense: 'fixture sense',
        associations: [],
        role: 'long',
        confidence: 0.5,
      },
    ]);
  });

  it('honors injected suggestions and clue drafts', async () => {
    const adapter = createFakeLocalModelAdapter({
      suggestions: [
        {
          surface: 'OTTER',
          intendedSense: 'a playful swimmer',
          associations: [],
          role: 'general',
          confidence: 0.9,
        },
      ],
      clueDrafts: [
        { mechanism: 'oblique', text: 'River dancer', difficulty: 0.7 },
      ],
    });

    await expect(adapter.generateCandidates(request)).resolves.toHaveLength(1);
    await expect(
      adapter.composeClues({
        answer: 'OTTER',
        intendedSense: 'a playful swimmer',
      }),
    ).resolves.toEqual([
      { mechanism: 'oblique', text: 'River dancer', difficulty: 0.7 },
    ]);
  });

  it('guards generation after unload until the next load and records calls', async () => {
    const adapter = createFakeLocalModelAdapter();
    await adapter.install(manifest);
    await adapter.load(manifest);
    await adapter.unload();
    await expect(adapter.generateCandidates(request)).rejects.toThrow(
      'not loaded',
    );
    await adapter.load(manifest);
    await expect(adapter.generateCandidates(request)).resolves.toBeDefined();

    expect(adapter.calls.install()).toBe(1);
    expect(adapter.calls.load()).toBe(2);
    expect(adapter.calls.unload()).toBe(1);
  });
});
