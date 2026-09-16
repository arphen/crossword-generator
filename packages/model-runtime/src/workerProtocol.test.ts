import { describe, expect, it } from 'vitest';
import { parseModelWorkerRequest, parseModelWorkerResponse } from './workerProtocol';

const config = {
  manifest: {
    schemaVersion: 1 as const,
    id: 'fixture-model',
    version: '1',
    quantization: 'fixture',
    runtimeVersion: 'fixture',
    promptVersion: 'fixture',
    minimumMemoryMb: 1,
    shards: [{ url: '/fixture', sha256: 'a'.repeat(64), bytes: 1 }]
  },
  runtime: { webgpu: true, availableMemoryMb: 2, storageQuotaBytes: 2, storageUsageBytes: 0 }
};

describe('model worker protocol', () => {
  it('accepts configure, execution, and cancellation messages', () => {
    expect(parseModelWorkerRequest({ version: 1, type: 'configure', requestId: 'one', config })).toMatchObject({ type: 'configure', requestId: 'one' });
    expect(parseModelWorkerRequest({
      version: 1,
      type: 'execute',
      requestId: 'two',
      operation: 'generate-candidates',
      payload: {
        seed: 'fixture',
        audienceSummary: 'broad',
        requestedRoles: ['theme', 'long'],
        excludedAnswers: [],
        maxSuggestions: 32,
        focus: 'coastal ecology and long domain vocabulary',
        targetLengths: [10, 11, 12, 13, 14, 15]
      }
    })).toMatchObject({ type: 'execute', operation: 'generate-candidates' });
    expect(parseModelWorkerRequest({ version: 1, type: 'execute', requestId: 'three', operation: 'load' })).toMatchObject({ type: 'execute', operation: 'load' });
    expect(parseModelWorkerRequest({ version: 1, type: 'cancel', requestId: 'two' })).toEqual({ version: 1, type: 'cancel', requestId: 'two' });
  });

  it('rejects invalid config, payloads, and results', () => {
    expect(parseModelWorkerRequest({ version: 1, type: 'configure', requestId: 'one', config: { ...config, manifest: { ...config.manifest, distribution: 'remote-cloud' } } })).toBeUndefined();
    expect(parseModelWorkerRequest({ version: 1, type: 'execute', requestId: 'two', operation: 'generate-candidates', payload: {} })).toBeUndefined();
    expect(parseModelWorkerRequest({
      version: 1,
      type: 'execute',
      requestId: 'three',
      operation: 'generate-candidates',
      payload: {
        seed: 'fixture',
        audienceSummary: 'broad',
        requestedRoles: ['long'],
        excludedAnswers: [],
        maxSuggestions: 32,
        targetLengths: [2]
      }
    })).toBeUndefined();
    expect(parseModelWorkerResponse({ version: 1, type: 'result', requestId: 'one', operation: 'load', result: { ok: false, error: { code: 'unknown', message: 'bad' } } })).toBeUndefined();
  });
});