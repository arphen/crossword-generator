import { describe, expect, it, vi } from 'vitest';
import type { ModelManifest } from './broker';
import { createWebLLMAdapter, type WebLlmEngine, type WebLlmModule } from './webllmAdapter';

const manifest: ModelManifest = {
  schemaVersion: 1,
  id: 'fixture-model',
  version: '1',
  quantization: 'q4f16_1',
  runtimeVersion: 'webllm-fixture',
  promptVersion: 'candidate-v1',
  minimumMemoryMb: 1,
  shards: [],
  distribution: 'webllm-mlc'
};

function fakeEngine(content: string): WebLlmEngine {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => ({ choices: [{ message: { content } }] }))
      }
    },
    unload: vi.fn(async () => undefined),
    interruptGenerate: vi.fn(() => undefined)
  } as unknown as WebLlmEngine;
}

function fakeModule(engine: WebLlmEngine, createSpy: (modelId: string) => Promise<WebLlmEngine>): WebLlmModule {
  return {
    prebuiltAppConfig: { model_list: [{ model_id: 'fixture-model' }, { model_id: 'other-model' }] },
    CreateWebWorkerMLCEngine: createSpy
  } as unknown as WebLlmModule;
}

const request = {
  seed: 'fixture',
  audienceSummary: 'broad',
  requestedRoles: ['long'] as const,
  excludedAnswers: [],
  maxSuggestions: 2,
  focus: 'coastal ecology',
  targetLengths: [9, 10]
};

describe('in-browser WebLLM adapter', () => {
  it('rejects model ids outside the prebuilt catalog without creating an engine', async () => {
    const engine = fakeEngine('');
    const createEngine = vi.fn(async () => engine);
    const adapter = createWebLLMAdapter({
      loadModule: async () => fakeModule(engine, createEngine),
      createEngine
    });

    await expect(adapter.install({ ...manifest, id: 'unknown-model' })).rejects.toThrow(/catalog/);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it('installs, loads once, generates structured output, and unloads', async () => {
    const engine = fakeEngine('```json\n[{"surface":"CAT","intendedSense":"a small animal","associations":[],"role":"general","confidence":0.8}]\n```');
    const createEngine = vi.fn(async () => engine);
    const adapter = createWebLLMAdapter({
      loadModule: async () => fakeModule(engine, createEngine),
      createEngine
    });

    await adapter.install(manifest);
    await adapter.load(manifest);
    expect(createEngine).toHaveBeenCalledTimes(1);

    await expect(adapter.generateCandidates(request)).resolves.toEqual([
      { surface: 'CAT', intendedSense: 'a small animal', associations: [], role: 'general', confidence: 0.8 }
    ]);
    await adapter.unload();
    await expect(adapter.generateCandidates(request)).rejects.toThrow('not loaded');
  });

  it('recreates the engine from cache when loading after unload', async () => {
    const engine = fakeEngine('[]');
    const createEngine = vi.fn(async () => engine);
    const adapter = createWebLLMAdapter({
      loadModule: async () => fakeModule(engine, createEngine),
      createEngine
    });

    await adapter.install(manifest);
    await adapter.unload();
    await adapter.load(manifest);
    expect(createEngine).toHaveBeenCalledTimes(2);
  });

  it('normalizes loose candidate lists without bypassing broker validation', async () => {
    const engine = fakeEngine('{"candidates":["TIDAL POOL", "KELPFOREST"]}');
    const adapter = createWebLLMAdapter({
      loadModule: async () => fakeModule(engine, async () => engine),
      createEngine: async () => engine
    });
    await adapter.load(manifest);

    await expect(adapter.generateCandidates(request)).resolves.toEqual([
      { surface: 'TIDAL POOL', intendedSense: 'Unresolved model association', associations: [], role: 'long', confidence: 0.2 },
      { surface: 'KELPFOREST', intendedSense: 'Unresolved model association', associations: [], role: 'long', confidence: 0.2 }
    ]);
  });

  it('normalizes answer fields and confidence labels from lightweight models', async () => {
    const engine = fakeEngine('{"candidates":[{"answer":"coastal wetlands","intendedSense":"ecological feature","associations":["habitat",3],"role":"theme","confidence":"high"},{"answer":"mangroves","role":"interpreter","confidence":"low"}]}');
    const adapter = createWebLLMAdapter({
      loadModule: async () => fakeModule(engine, async () => engine),
      createEngine: async () => engine
    });
    await adapter.load(manifest);

    await expect(adapter.generateCandidates(request)).resolves.toEqual([
      { surface: 'coastal wetlands', intendedSense: 'ecological feature', associations: ['habitat'], role: 'theme', confidence: 0.8 },
      { surface: 'mangroves', intendedSense: 'Unresolved model association', associations: [], role: 'long', confidence: 0.2 }
    ]);
  });

  it('normalizes clue drafts to the broker mechanism vocabulary', async () => {
    const engine = fakeEngine('[{"mechanism":"definition","text":"A watery expanse","difficulty":"easy"}]');
    const adapter = createWebLLMAdapter({
      loadModule: async () => fakeModule(engine, async () => engine),
      createEngine: async () => engine
    });
    await adapter.load(manifest);

    await expect(adapter.composeClues({ answer: 'TIDALPOOL', intendedSense: 'a coastal body of water' })).resolves.toEqual([
      { mechanism: 'standard', text: 'A watery expanse', difficulty: 0.4 }
    ]);
  });
});
