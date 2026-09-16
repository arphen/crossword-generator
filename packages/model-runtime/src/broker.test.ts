import { describe, expect, it } from 'vitest';
import { createModelBroker, type LocalModelAdapter, type ModelManifest, type RuntimeProbe } from './broker';

const manifest: ModelManifest = {
  schemaVersion: 1,
  id: 'qwen3.8:27b',
  version: 'q4-k-m',
  quantization: 'Q4_K_M',
  runtimeVersion: 'webllm-fixture',
  promptVersion: 'candidate-v1',
  minimumMemoryMb: 1,
  shards: [{ url: '/models/fixture.bin', sha256: 'a'.repeat(64), bytes: 1 }]
};

const runtime: RuntimeProbe = {
  webgpu: true,
  availableMemoryMb: 2,
  storageQuotaBytes: 10,
  storageUsageBytes: 0
};

function adapter(output: unknown): LocalModelAdapter {
  return {
    install: async () => undefined,
    load: async () => undefined,
    generateCandidates: async () => output,
    composeClues: async () => [{ mechanism: 'direct', text: 'A clue', difficulty: 0.2 }],
    unload: async () => undefined
  };
}

describe('mandatory local model broker', () => {
  it('refuses original construction until the model is loaded', async () => {
    const broker = createModelBroker(manifest, adapter([]), runtime);

    const result = await broker.generateCandidates({
      seed: 'fixture',
      audienceSummary: 'broad',
      requestedRoles: ['general'],
      excludedAnswers: [],
      maxSuggestions: 4
    });

    expect(result).toEqual({ ok: false, error: { code: 'model-not-enabled', message: 'Load the local model before original construction' } });
  });

  it('returns a typed capability failure for unsupported hardware', async () => {
    const broker = createModelBroker(manifest, adapter([]), { ...runtime, webgpu: false });

    const result = await broker.install();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported-device');
    expect(broker.state()).toBe('uninstalled');
  });

  it('validates structured model output and unloads after preparation', async () => {
    const broker = createModelBroker(manifest, adapter([
      {
        surface: 'CAT',
        intendedSense: 'a small animal',
        associations: ['pet'],
        role: 'general',
        confidence: 0.8
      }
    ]), runtime);
    await broker.install();
    await broker.load();

    const result = await broker.generateCandidates({
      seed: 'fixture',
      audienceSummary: 'broad',
      requestedRoles: ['general'],
      excludedAnswers: [],
      maxSuggestions: 4
    });

    expect(result.ok).toBe(true);
    expect(broker.state()).toBe('loaded');
    expect((await broker.unload()).ok).toBe(true);
    expect(broker.state()).toBe('installed');
  });

  it('rejects malformed output without accepting a deterministic fallback', async () => {
    const broker = createModelBroker(manifest, adapter([{ surface: 'CAT' }]), runtime);
    await broker.install();
    await broker.load();

    const result = await broker.generateCandidates({
      seed: 'fixture',
      audienceSummary: 'broad',
      requestedRoles: ['general'],
      excludedAnswers: [],
      maxSuggestions: 4
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-model-output');
  });
});
