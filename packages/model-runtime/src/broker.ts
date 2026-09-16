export type ModelShard = Readonly<{
  url: string;
  sha256: string;
  bytes: number;
}>;

export type ModelManifest = Readonly<{
  schemaVersion: 1;
  id: string;
  version: string;
  quantization: string;
  runtimeVersion: string;
  promptVersion: string;
  minimumMemoryMb: number;
  shards: readonly ModelShard[];
  distribution?: 'webllm-mlc';
}>;

export type RuntimeProbe = Readonly<{
  webgpu: boolean;
  availableMemoryMb: number;
  storageQuotaBytes: number;
  storageUsageBytes: number;
}>;

export type CandidateRole = 'theme' | 'long' | 'general' | 'glue' | 'stretch';

export type CandidateSuggestion = Readonly<{
  surface: string;
  intendedSense: string;
  associations: readonly string[];
  role: CandidateRole;
  confidence: number;
}>;

export type CandidateRequest = Readonly<{
  seed: string;
  audienceSummary: string;
  requestedRoles: readonly CandidateRole[];
  excludedAnswers: readonly string[];
  maxSuggestions: number;
  focus?: string;
  targetLengths?: readonly number[];
}>;

export type ClueDraft = Readonly<{
  mechanism: 'direct' | 'standard' | 'oblique' | 'nudge';
  text: string;
  difficulty: number;
}>;

export type ModelState = 'uninstalled' | 'installed' | 'loaded' | 'generating' | 'unloading';
export type ModelFailureCode = 'unsupported-device' | 'storage-quota' | 'model-not-enabled' | 'invalid-model-output' | 'busy' | 'cancelled';
export type BrokerResult<T> = Readonly<{ ok: true; value: T } | { ok: false; error: Readonly<{ code: ModelFailureCode; message: string }> }>;

export type LocalModelAdapter = Readonly<{
  install: (manifest: ModelManifest, signal?: AbortSignal) => Promise<void>;
  load: (manifest: ModelManifest, signal?: AbortSignal) => Promise<void>;
  generateCandidates: (request: CandidateRequest, signal?: AbortSignal) => Promise<unknown>;
  composeClues: (request: Readonly<{ answer: string; intendedSense: string }>, signal?: AbortSignal) => Promise<unknown>;
  unload: () => Promise<void>;
}>;

export type ModelBroker = Readonly<{
  state: () => ModelState;
  probe: () => RuntimeProbe;
  install: (signal?: AbortSignal) => Promise<BrokerResult<void>>;
  load: (signal?: AbortSignal) => Promise<BrokerResult<void>>;
  generateCandidates: (request: CandidateRequest, signal?: AbortSignal) => Promise<BrokerResult<readonly CandidateSuggestion[]>>;
  composeClues: (request: Readonly<{ answer: string; intendedSense: string }>, signal?: AbortSignal) => Promise<BrokerResult<readonly ClueDraft[]>>;
  unload: () => Promise<BrokerResult<void>>;
}>;

const candidateRoles: readonly CandidateRole[] = ['theme', 'long', 'general', 'glue', 'stretch'];
const clueMechanisms = ['direct', 'standard', 'oblique', 'nudge'] as const;
const MAX_SUGGESTIONS = 64;
const MAX_TEXT_LENGTH = 500;
const MAX_TARGET_LENGTHS = 8;

function success<T>(value: T): BrokerResult<T> {
  return { ok: true, value };
}

function failure<T>(code: ModelFailureCode, message: string): BrokerResult<T> {
  return { ok: false, error: { code, message } };
}

function isManifestValid(manifest: ModelManifest): boolean {
  // webllm-mlc (ADR 0002) delegates weight integrity to the pinned WebLLM
  // runtime manifest; M2.4 records explicit shard receipts. Shards are
  // optional, but any recorded shard still needs a digest and size.
  return manifest.schemaVersion === 1
    && Boolean(manifest.id && manifest.version && manifest.quantization && manifest.runtimeVersion && manifest.promptVersion)
    && (manifest.distribution === undefined || manifest.distribution === 'webllm-mlc')
    && Number.isInteger(manifest.minimumMemoryMb)
    && manifest.minimumMemoryMb > 0
    && manifest.shards.every((shard) => Boolean(shard.url) && /^[a-f0-9]{64}$/.test(shard.sha256) && Number.isInteger(shard.bytes) && shard.bytes > 0);
}

function isCandidateSuggestion(value: unknown): value is CandidateSuggestion {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.surface === 'string'
    && candidate.surface.length > 0
    && candidate.surface.length <= MAX_TEXT_LENGTH
    && typeof candidate.intendedSense === 'string'
    && candidate.intendedSense.length > 0
    && candidate.intendedSense.length <= MAX_TEXT_LENGTH
    && Array.isArray(candidate.associations)
    && candidate.associations.length <= 16
    && candidate.associations.every((association) => typeof association === 'string' && association.length <= MAX_TEXT_LENGTH)
    && candidateRoles.includes(candidate.role as CandidateRole)
    && typeof candidate.confidence === 'number'
    && Number.isFinite(candidate.confidence)
    && candidate.confidence >= 0
    && candidate.confidence <= 1;
}

function isClueDraft(value: unknown): value is ClueDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  return clueMechanisms.includes(draft.mechanism as typeof clueMechanisms[number])
    && typeof draft.text === 'string'
    && draft.text.length > 0
    && draft.text.length <= MAX_TEXT_LENGTH
    && typeof draft.difficulty === 'number'
    && Number.isFinite(draft.difficulty)
    && draft.difficulty >= 0
    && draft.difficulty <= 1;
}

function isCancelled(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function isCandidateRequestValid(request: CandidateRequest): boolean {
  return Number.isInteger(request.maxSuggestions)
    && request.maxSuggestions >= 1
    && request.maxSuggestions <= MAX_SUGGESTIONS
    && (request.focus === undefined || (request.focus.trim().length > 0 && request.focus.length <= MAX_TEXT_LENGTH))
    && (request.targetLengths === undefined || (
      request.targetLengths.length > 0
      && request.targetLengths.length <= MAX_TARGET_LENGTHS
      && request.targetLengths.every((length) => Number.isInteger(length) && length >= 3 && length <= 15)
    ));
}

export function createModelBroker(manifest: ModelManifest, adapter: LocalModelAdapter, runtime: RuntimeProbe): ModelBroker {
  if (!isManifestValid(manifest)) throw new Error('Invalid model manifest');
  let currentState: ModelState = 'uninstalled';

  const canInstall = (): BrokerResult<void> => {
    if (!runtime.webgpu || runtime.availableMemoryMb < manifest.minimumMemoryMb) return failure('unsupported-device', 'This device does not meet the local model requirements');
    const requiredBytes = manifest.shards.reduce((total, shard) => total + shard.bytes, 0);
    if (runtime.storageQuotaBytes - runtime.storageUsageBytes < requiredBytes) return failure('storage-quota', 'There is not enough local storage for the pinned model');
    return success(undefined);
  };

  return {
    state: () => currentState,
    probe: () => runtime,
    async install(signal) {
      const capability = canInstall();
      if (!capability.ok) return capability;
      if (isCancelled(signal)) return failure('cancelled', 'Model installation cancelled');
      await adapter.install(manifest, signal);
      if (isCancelled(signal)) return failure('cancelled', 'Model installation cancelled');
      currentState = 'installed';
      return success(undefined);
    },
    async load(signal) {
      if (currentState === 'uninstalled') return failure('model-not-enabled', 'Install the pinned local model before loading it');
      if (currentState === 'generating' || currentState === 'unloading') return failure('busy', 'The local model is busy');
      if (currentState === 'loaded') return success(undefined);
      if (isCancelled(signal)) return failure('cancelled', 'Model loading cancelled');
      await adapter.load(manifest, signal);
      if (isCancelled(signal)) return failure('cancelled', 'Model loading cancelled');
      currentState = 'loaded';
      return success(undefined);
    },
    async generateCandidates(request, signal) {
      if (currentState === 'generating' || currentState === 'unloading') return failure('busy', 'The local model is busy');
      if (currentState !== 'loaded') return failure('model-not-enabled', 'Load the local model before original construction');
      if (!isCandidateRequestValid(request)) return failure('invalid-model-output', 'Candidate request contains invalid bounded constraints');
      if (isCancelled(signal)) return failure('cancelled', 'Candidate generation cancelled');
      currentState = 'generating';
      try {
        const output = await adapter.generateCandidates(request, signal);
        if (isCancelled(signal)) return failure('cancelled', 'Candidate generation cancelled');
        if (!Array.isArray(output) || output.length > request.maxSuggestions || !output.every(isCandidateSuggestion)) return failure('invalid-model-output', 'The local model returned an invalid candidate bag');
        return success(output);
      } finally {
        currentState = 'loaded';
      }
    },
    async composeClues(request, signal) {
      if (currentState === 'generating' || currentState === 'unloading') return failure('busy', 'The local model is busy');
      if (currentState !== 'loaded') return failure('model-not-enabled', 'Load the local model before original construction');
      if (isCancelled(signal)) return failure('cancelled', 'Clue generation cancelled');
      currentState = 'generating';
      try {
        const output = await adapter.composeClues(request, signal);
        if (isCancelled(signal)) return failure('cancelled', 'Clue generation cancelled');
        if (!Array.isArray(output) || output.length === 0 || output.length > 4 || !output.every(isClueDraft)) return failure('invalid-model-output', 'The local model returned invalid clue drafts');
        return success(output);
      } finally {
        currentState = 'loaded';
      }
    },
    async unload() {
      if (currentState === 'uninstalled' || currentState === 'installed') return success(undefined);
      if (currentState === 'generating') return failure('busy', 'Wait for the current local generation to finish');
      currentState = 'unloading';
      try {
        await adapter.unload();
        currentState = 'installed';
        return success(undefined);
      } catch (error) {
        currentState = 'loaded';
        throw error;
      }
    }
  };
}
