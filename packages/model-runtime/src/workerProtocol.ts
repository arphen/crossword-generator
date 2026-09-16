import type {
  BrokerResult,
  CandidateRequest,
  ClueDraft,
  ModelManifest,
  ModelState,
  RuntimeProbe
} from './broker';

export type ModelWorkerConfig = Readonly<{
  manifest: ModelManifest;
  runtime: RuntimeProbe;
}>;

export type ModelWorkerOperation = 'install' | 'load' | 'generate-candidates' | 'compose-clues' | 'unload';
type ModelWorkerPayload = CandidateRequest | Readonly<{ answer: string; intendedSense: string }>;

export type ModelWorkerRequest = Readonly<
  | { version: 1; type: 'configure'; requestId: string; config: ModelWorkerConfig }
  | { version: 1; type: 'execute'; requestId: string; operation: ModelWorkerOperation; payload?: CandidateRequest | Readonly<{ answer: string; intendedSense: string }> }
  | { version: 1; type: 'cancel'; requestId: string }
>;

export type ModelWorkerResponse = Readonly<
  | { version: 1; type: 'state'; state: ModelState }
  | { version: 1; type: 'result'; requestId: string; operation: ModelWorkerOperation | 'configure'; result: BrokerResult<unknown> }
  | { version: 1; type: 'protocol-error'; requestId?: string; message: string }
>;

const modelStates: readonly ModelState[] = ['uninstalled', 'installed', 'loaded', 'generating', 'unloading'];
const operations: readonly ModelWorkerOperation[] = ['install', 'load', 'generate-candidates', 'compose-clues', 'unload'];
const failureCodes = ['unsupported-device', 'storage-quota', 'model-not-enabled', 'invalid-model-output', 'busy', 'cancelled'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isManifest(value: unknown): value is ModelManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.id !== 'string' || typeof value.version !== 'string' || typeof value.quantization !== 'string' || typeof value.runtimeVersion !== 'string' || typeof value.promptVersion !== 'string' || !isFiniteNumber(value.minimumMemoryMb) || !Array.isArray(value.shards) || (value.distribution !== undefined && value.distribution !== 'webllm-mlc')) return false;
  return value.shards.every((shard) => isRecord(shard) && typeof shard.url === 'string' && typeof shard.sha256 === 'string' && /^[a-f0-9]{64}$/.test(shard.sha256) && Number.isInteger(shard.bytes) && (shard.bytes as number) > 0);
}

function isRuntime(value: unknown): value is RuntimeProbe {
  return isRecord(value) && typeof value.webgpu === 'boolean' && isFiniteNumber(value.availableMemoryMb) && isFiniteNumber(value.storageQuotaBytes) && isFiniteNumber(value.storageUsageBytes);
}

function isCandidateRequest(value: unknown): value is CandidateRequest {
  return isRecord(value)
    && typeof value.seed === 'string'
    && typeof value.audienceSummary === 'string'
    && Array.isArray(value.requestedRoles)
    && value.requestedRoles.every((role) => ['theme', 'long', 'general', 'glue', 'stretch'].includes(role as string))
    && Array.isArray(value.excludedAnswers)
    && value.excludedAnswers.every((answer) => typeof answer === 'string')
    && Number.isInteger(value.maxSuggestions)
    && (value.maxSuggestions as number) > 0
    && (value.maxSuggestions as number) <= 64
    && (value.focus === undefined || (typeof value.focus === 'string' && value.focus.trim().length > 0 && value.focus.length <= 500))
    && (value.targetLengths === undefined || (
      Array.isArray(value.targetLengths)
      && value.targetLengths.length > 0
      && value.targetLengths.length <= 8
      && value.targetLengths.every((length) => Number.isInteger(length) && length >= 3 && length <= 15)
    ));
}

function isClueRequest(value: unknown): value is Readonly<{ answer: string; intendedSense: string }> {
  return isRecord(value) && typeof value.answer === 'string' && typeof value.intendedSense === 'string';
}

export function parseModelWorkerRequest(value: unknown): ModelWorkerRequest | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.type !== 'string') return undefined;
  if (value.type === 'cancel' && typeof value.requestId === 'string' && value.requestId) return { version: 1, type: 'cancel', requestId: value.requestId };
  if (value.type === 'configure' && typeof value.requestId === 'string' && value.requestId && isRecord(value.config) && isManifest(value.config.manifest) && isRuntime(value.config.runtime)) {
    return {
      version: 1,
      type: 'configure',
      requestId: value.requestId,
      config: {
        manifest: value.config.manifest,
        runtime: value.config.runtime
      }
    };
  }
  if (value.type !== 'execute' || typeof value.requestId !== 'string' || !value.requestId || !operations.includes(value.operation as ModelWorkerOperation)) return undefined;
  const operation = value.operation as ModelWorkerOperation;
  if (operation === 'generate-candidates' && !isCandidateRequest(value.payload)) return undefined;
  if (operation === 'compose-clues' && !isClueRequest(value.payload)) return undefined;
  return { version: 1, type: 'execute', requestId: value.requestId, operation, payload: value.payload as ModelWorkerPayload };
}

function isBrokerResult(value: unknown): value is BrokerResult<unknown> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) return true;
  return isRecord(value.error) && failureCodes.includes(value.error.code as typeof failureCodes[number]) && typeof value.error.message === 'string';
}

export function parseModelWorkerResponse(value: unknown): ModelWorkerResponse | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.type !== 'string') return undefined;
  if (value.type === 'state' && modelStates.includes(value.state as ModelState)) return { version: 1, type: 'state', state: value.state as ModelState };
  if (value.type === 'protocol-error' && typeof value.message === 'string' && (value.requestId === undefined || typeof value.requestId === 'string')) return { version: 1, type: 'protocol-error', requestId: value.requestId, message: value.message };
  if (value.type === 'result' && typeof value.requestId === 'string' && value.requestId && (value.operation === 'configure' || operations.includes(value.operation as ModelWorkerOperation)) && isBrokerResult(value.result)) {
    return { version: 1, type: 'result', requestId: value.requestId, operation: value.operation as ModelWorkerOperation | 'configure', result: value.result };
  }
  return undefined;
}