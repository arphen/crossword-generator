import type {
  FillCandidate,
  FillProgress,
  FillResult,
  FillSolution,
} from '@crossword/construction';
import {
  createBrowserConstructorWorker,
  type ConstructorWorkerClient,
} from '@crossword/generator/constructor-client';
import {
  createBrowserModelWorkerClient,
  type ModelWorkerClient,
} from '@crossword/generator/model-client';
import {
  generateCandidateBatches,
  type CandidateBatchObservation,
} from '@crossword/generator';
import type {
  CandidateRequest,
  CandidateRole,
  CandidateSuggestion,
  ClueDraft,
  ModelBroker,
  ModelManifest,
  ModelProgress,
  ModelState,
  RuntimeProbe,
} from '@crossword/model-runtime';
import {
  createFakeLocalModelAdapter,
  createModelBroker,
} from '@crossword/model-runtime';
import {
  FIXTURE_SUGGESTIONS,
  MINI_TEMPLATE,
  candidateFromEntry,
  createFixtureBroker,
  fixtureCrossingWords,
  getFixtureEntry,
  manualSuggestion,
  projectSolutionToGrid,
  resolveSuggestion,
  type CandidateDecision,
  type LabSourceLabel,
  type ProjectedGrid,
} from './fixture';

export const STAGE_IDS = [
  'prepare',
  'generate',
  'resolve',
  'fill',
  'clues',
  'review',
] as const;
export type StageId = (typeof STAGE_IDS)[number];
export type StageStatus =
  | 'idle'
  | 'running'
  | 'passed'
  | 'failed'
  | 'cancelled';
export type LabMode = 'fixture' | 'local-model';
export type LabModelProfileId =
  | 'llama-1b-q4f16'
  | 'llama-1b-q4f32'
  | 'llama-3b-q4f16';

export type LabRecipe = Readonly<{
  mode: LabMode;
  modelProfile: LabModelProfileId;
  seed: string;
  audienceSummary: string;
  focus: string;
  requestedRoles: readonly CandidateRole[];
  candidateBatches: number;
  maxSuggestions: number;
  nodeBudget: number;
  qualityThreshold: number;
  manualCandidates: string;
  verboseTrace: boolean;
  includeRawDebug: boolean;
}>;

export const DEFAULT_RECIPE: LabRecipe = {
  mode: 'fixture',
  modelProfile: 'llama-1b-q4f16',
  seed: 'luna-fixture-001',
  audienceSummary: 'A small experimental crossword lab',
  focus: 'short synthetic crossing words',
  requestedRoles: ['general', 'glue'],
  candidateBatches: 1,
  maxSuggestions: 16,
  nodeBudget: 5000,
  qualityThreshold: 0,
  manualCandidates: '',
  verboseTrace: false,
  includeRawDebug: false,
};

export type LabEvent = Readonly<{
  schemaVersion: 1;
  sequence: number;
  runId: string;
  timestampMs: number;
  stage: StageId;
  kind: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  requestId?: string;
  jobId?: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type StageState = Readonly<{
  id: StageId;
  label: string;
  status: StageStatus;
  startedAtMs?: number;
  endedAtMs?: number;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  details?: unknown;
  failure?: Readonly<{ code: string; message: string }>;
}>;

export type FillEvidence = Readonly<{
  request: Readonly<Record<string, unknown>>;
  result: FillResult;
  progress?: FillProgress;
  grid?: ProjectedGrid;
}>;

export type ClueEvidence = Readonly<{
  slotId: string;
  answer: string;
  source: LabSourceLabel;
  intendedSense: string;
  drafts: readonly ClueDraft[];
}>;

export type LabFeedback = Readonly<{
  rating: '' | 'useful' | 'mixed' | 'not-useful';
  stage: '' | StageId;
  observation: string;
  expectedBehavior: string;
  reproductionNotes: string;
}>;

export const EMPTY_FEEDBACK: LabFeedback = {
  rating: '',
  stage: '',
  observation: '',
  expectedBehavior: '',
  reproductionNotes: '',
};

export type LabEnvironment = Readonly<{
  source: 'fixture' | 'browser';
  manifest: Readonly<
    Pick<ModelManifest, 'id' | 'version' | 'runtimeVersion' | 'promptVersion'>
  >;
  runtime?: RuntimeProbe & Readonly<{ memorySource?: string }>;
  modelState: ModelState;
}>;

export type LabReport = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  runId: string;
  mode: LabMode;
  recipe: LabRecipe;
  template: Readonly<{
    id: string;
    version: number;
    width: number;
    height: number;
    slots: typeof MINI_TEMPLATE.slots;
    intersections: typeof MINI_TEMPLATE.intersections;
  }>;
  stages: Readonly<Record<StageId, StageState>>;
  candidateDecisions: readonly CandidateDecision[];
  fill?: FillEvidence;
  clues: readonly ClueEvidence[];
  events: readonly LabEvent[];
  droppedEventCount: number;
  environment?: LabEnvironment;
  feedback: LabFeedback;
  caveats: readonly string[];
}>;

export type HistoricalEvidence = Readonly<{
  runId: string;
  recipe: LabRecipe;
  stages: Readonly<Record<StageId, StageState>>;
  candidateDecisions: readonly CandidateDecision[];
  fill?: FillEvidence;
  clues: readonly ClueEvidence[];
}>;

export type LabSnapshot = Readonly<{
  runId: string;
  recipe: LabRecipe;
  stages: Readonly<Record<StageId, StageState>>;
  currentStage?: StageId;
  modelState: ModelState;
  modelProgress?: ModelProgress;
  suggestions: readonly CandidateSuggestion[];
  candidateDecisions: readonly CandidateDecision[];
  acceptedCandidates: readonly FillCandidate[];
  fill?: FillEvidence;
  clues: readonly ClueEvidence[];
  grid?: ProjectedGrid;
  environment?: LabEnvironment;
  feedback: LabFeedback;
  events: readonly LabEvent[];
  droppedEventCount: number;
  historical?: HistoricalEvidence;
  report?: LabReport;
}>;

type StageOutcome = Readonly<{
  ok: boolean;
  outputSummary: string;
  details?: unknown;
  failure?: Readonly<{ code: string; message: string }>;
  status?: 'failed' | 'cancelled';
}>;

export type LabRunnerDependencies = Readonly<{
  now?: () => number;
  makeId?: () => string;
  createFixtureModel?: () => ModelBroker;
  createLocalModel?: () => ModelWorkerClient;
  createFillClient?: () => ConstructorWorkerClient;
}>;

export interface LabRunner {
  snapshot(): LabSnapshot;
  subscribe(listener: (snapshot: LabSnapshot) => void): () => void;
  runNext(): Promise<boolean>;
  runAll(): Promise<void>;
  cancel(): void;
  reset(recipe?: LabRecipe): void;
  setFeedback(feedback: LabFeedback): void;
  exportReport(options?: { includeRawDebug?: boolean }): LabReport;
  dispose(): void;
}

export const PINNED_DEV_MANIFEST: ModelManifest = {
  schemaVersion: 1,
  id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  version: 'webllm-0.2.85-catalog',
  quantization: 'q4f16_1',
  runtimeVersion: 'webllm-0.2.85',
  promptVersion: 'crossword-lab-v1',
  minimumMemoryMb: 1024,
  shards: [],
  distribution: 'webllm-mlc',
};

export const LOCAL_MODEL_PROFILES: readonly Readonly<{
  id: LabModelProfileId;
  label: string;
  manifest: ModelManifest;
}>[] = [
  {
    id: 'llama-1b-q4f16',
    label: 'Llama 3.2 1B · q4f16 (pinned default)',
    manifest: PINNED_DEV_MANIFEST,
  },
  {
    id: 'llama-1b-q4f32',
    label: 'Llama 3.2 1B · q4f32 (comparison)',
    manifest: {
      ...PINNED_DEV_MANIFEST,
      id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
      quantization: 'q4f32_1',
      minimumMemoryMb: 1400,
    },
  },
  {
    id: 'llama-3b-q4f16',
    label: 'Llama 3.2 3B · q4f16 (comparison)',
    manifest: {
      ...PINNED_DEV_MANIFEST,
      id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
      quantization: 'q4f16_1',
      minimumMemoryMb: 3072,
    },
  },
];

const STAGE_LABELS: Record<StageId, string> = {
  prepare: 'Prepare',
  generate: 'Generate candidates',
  resolve: 'Resolve lexicon',
  fill: 'Solve fill',
  clues: 'Draft clues',
  review: 'Review report',
};

function initialStages(): Record<StageId, StageState> {
  return Object.fromEntries(
    STAGE_IDS.map((id) => [
      id,
      { id, label: STAGE_LABELS[id], status: 'idle' },
    ]),
  ) as Record<StageId, StageState>;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function defaultId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    return crypto.randomUUID();
  return `lab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function numberSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function summarize(value: unknown): unknown {
  if (typeof value === 'string')
    return value.length > 320 ? `${value.slice(0, 317)}...` : value;
  if (Array.isArray(value)) return value.slice(0, 64).map(summarize);
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).slice(0, 64);
    return Object.fromEntries(
      entries.map(([key, item]) => [key, summarize(item)]),
    );
  }
  return value;
}

function boundedData(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const summarized = summarize(value) as Record<string, unknown>;
  try {
    const encoded = JSON.stringify(summarized);
    if (encoded.length <= 4000) return summarized;
    return { truncated: true, preview: encoded.slice(0, 3950) };
  } catch {
    return { unavailable: 'Event data was not serializable' };
  }
}

function runtimeProbe(
  minimumMemoryMb = PINNED_DEV_MANIFEST.minimumMemoryMb,
): RuntimeProbe & Readonly<{ memorySource: string }> {
  const browserNavigator =
    typeof navigator !== 'undefined' ? navigator : undefined;
  const nav = browserNavigator as
    | (Navigator & { deviceMemory?: number })
    | undefined;
  const deviceMemory = nav?.deviceMemory;
  return {
    webgpu: Boolean(nav && 'gpu' in nav),
    availableMemoryMb:
      typeof deviceMemory === 'number' && deviceMemory > 0
        ? deviceMemory * 1024
        : minimumMemoryMb,
    memorySource:
      typeof deviceMemory === 'number'
        ? 'navigator.deviceMemory'
        : 'model floor estimate; browser did not expose deviceMemory',
    storageQuotaBytes: 0,
    storageUsageBytes: 0,
  };
}

async function browserRuntimeProbe(
  minimumMemoryMb = PINNED_DEV_MANIFEST.minimumMemoryMb,
): Promise<RuntimeProbe & Readonly<{ memorySource: string }>> {
  const probe = runtimeProbe(minimumMemoryMb);
  const storage =
    typeof navigator !== 'undefined' ? navigator.storage : undefined;
  let estimate: StorageEstimate | undefined;
  try {
    estimate = await storage?.estimate();
  } catch {
    estimate = undefined;
  }
  return {
    ...probe,
    storageQuotaBytes: estimate?.quota ?? 0,
    storageUsageBytes: estimate?.usage ?? 0,
  };
}

function stageSnapshot(state: LabSnapshot): HistoricalEvidence {
  return {
    runId: state.runId,
    recipe: state.recipe,
    stages: state.stages,
    candidateDecisions: state.candidateDecisions,
    fill: state.fill,
    clues: state.clues,
  };
}

class LabRunnerImpl implements LabRunner {
  private readonly now: () => number;
  private readonly makeId: () => string;
  private readonly dependencies: LabRunnerDependencies;
  private listeners = new Set<(snapshot: LabSnapshot) => void>();
  private controller: AbortController | undefined;
  private model: ModelBroker | undefined;
  private modelClient: ModelWorkerClient | undefined;
  private fillClient: ConstructorWorkerClient | undefined;
  private sequence = 0;
  private stateValue: LabSnapshot;

  public constructor(
    recipe: LabRecipe,
    dependencies: LabRunnerDependencies = {},
  ) {
    this.now = dependencies.now ?? defaultNow;
    this.makeId = dependencies.makeId ?? defaultId;
    this.dependencies = dependencies;
    this.stateValue = {
      runId: this.makeId(),
      recipe,
      stages: initialStages(),
      modelState: 'uninstalled',
      suggestions: [],
      candidateDecisions: [],
      acceptedCandidates: [],
      clues: [],
      feedback: EMPTY_FEEDBACK,
      events: [],
      droppedEventCount: 0,
    };
  }

  public snapshot(): LabSnapshot {
    return this.stateValue;
  }

  public subscribe(listener: (snapshot: LabSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.stateValue);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.stateValue);
  }

  private setState(update: (state: LabSnapshot) => LabSnapshot): void {
    this.stateValue = update(this.stateValue);
    this.notify();
  }

  private event(
    stage: StageId,
    kind: string,
    severity: LabEvent['severity'],
    data: Readonly<Record<string, unknown>> = {},
    ids: Readonly<Pick<LabEvent, 'requestId' | 'jobId'>> = {},
  ): void {
    const next: LabEvent = {
      schemaVersion: 1,
      sequence: ++this.sequence,
      runId: this.stateValue.runId,
      timestampMs: this.now(),
      stage,
      kind,
      severity,
      ...ids,
      data: boundedData(data),
    };
    const events = [...this.stateValue.events, next];
    const cap = 2000;
    const dropped = Math.max(0, events.length - cap);
    this.setState((state) => ({
      ...state,
      events: dropped > 0 ? events.slice(dropped) : events,
      droppedEventCount: state.droppedEventCount + (dropped > 0 ? dropped : 0),
    }));
  }

  private updateStage(stageId: StageId, update: Partial<StageState>): void {
    this.setState((state) => ({
      ...state,
      stages: {
        ...state.stages,
        [stageId]: { ...state.stages[stageId], ...update },
      },
    }));
  }

  private modelProgress(stage: StageId, progress: ModelProgress): void {
    this.setState((state) => ({ ...state, modelProgress: progress }));
    this.event(stage, 'model-progress', 'info', {
      operation: progress.operation,
      progress: progress.progress,
      text: progress.text,
    });
  }

  private async prepare(): Promise<StageOutcome> {
    const mode = this.stateValue.recipe.mode;
    const profile =
      LOCAL_MODEL_PROFILES.find(
        (item) => item.id === this.stateValue.recipe.modelProfile,
      ) ?? LOCAL_MODEL_PROFILES[0]!;
    const probe =
      mode === 'fixture'
        ? undefined
        : await browserRuntimeProbe(profile.manifest.minimumMemoryMb);
    const manifest =
      mode === 'fixture'
        ? {
            id: 'fixture-simulated-model',
            version: '1.0.0',
            runtimeVersion: 'fixture-runtime',
            promptVersion: 'fixture-v1',
          }
        : profile.manifest;
    this.setState((state) => ({
      ...state,
      environment: {
        source: mode === 'fixture' ? 'fixture' : 'browser',
        manifest,
        runtime: probe,
        modelState: 'uninstalled',
      },
    }));
    this.event('prepare', 'recipe-validated', 'success', {
      mode,
      template: `${MINI_TEMPLATE.id}@${MINI_TEMPLATE.version}`,
      seed: this.stateValue.recipe.seed,
      candidateBatches: this.stateValue.recipe.candidateBatches,
      maxSuggestions: this.stateValue.recipe.maxSuggestions,
      nodeBudget: this.stateValue.recipe.nodeBudget,
    });

    const onProgress = (progress: ModelProgress) =>
      this.modelProgress('prepare', progress);
    if (mode === 'fixture') {
      this.model =
        this.dependencies.createFixtureModel?.() ?? createFixtureBroker();
      const installed = await this.model.install(
        this.controller?.signal,
        onProgress,
      );
      if (!installed.ok)
        return this.prepareFailure(
          installed.error.code,
          installed.error.message,
        );
      const loaded = await this.model.load(this.controller?.signal, onProgress);
      if (!loaded.ok)
        return this.prepareFailure(loaded.error.code, loaded.error.message);
      this.setModelState(this.model.state());
      return {
        ok: true,
        outputSummary: 'Fixture adapter loaded; no model download occurred',
        details: {
          source: 'fixture',
          simulated: true,
          runtime: this.model.probe(),
        },
      };
    }

    this.modelClient =
      this.dependencies.createLocalModel?.() ??
      createBrowserModelWorkerClient();
    this.event('prepare', 'model-operation-start', 'info', {
      operation: 'configure',
      modelId: manifest.id,
    });
    const configured = await this.modelClient.configure({
      manifest: profile.manifest,
      runtime: probe!,
    });
    if (!configured.ok)
      return this.prepareFailure(
        configured.error.code,
        configured.error.message,
      );
    this.event('prepare', 'model-operation-start', 'info', {
      operation: 'install',
      modelId: manifest.id,
    });
    const installed = await this.modelClient.install(
      this.controller?.signal,
      onProgress,
    );
    if (!installed.ok)
      return this.prepareFailure(installed.error.code, installed.error.message);
    this.event('prepare', 'model-operation-start', 'info', {
      operation: 'load',
      modelId: manifest.id,
    });
    const loaded = await this.modelClient.load(
      this.controller?.signal,
      onProgress,
    );
    if (!loaded.ok)
      return this.prepareFailure(loaded.error.code, loaded.error.message);
    this.setModelState(this.modelClient.state());
    return {
      ok: true,
      outputSummary: `Pinned ${manifest.id} loaded`,
      details: { source: 'browser', simulated: false, runtime: probe },
    };
  }

  private prepareFailure(code: string, message: string): StageOutcome {
    const cancelled = code === 'cancelled' || this.controller?.signal.aborted;
    return {
      ok: false,
      status: cancelled ? 'cancelled' : 'failed',
      outputSummary: `${code}: ${message}`,
      failure: { code, message },
    };
  }

  private setModelState(modelState: ModelState): void {
    this.setState((state) => ({
      ...state,
      modelState,
      environment: state.environment
        ? { ...state.environment, modelState }
        : state.environment,
    }));
  }

  private brokerFacade(): ModelBroker {
    if (this.model) return this.model;
    const client = this.modelClient;
    if (!client) throw new Error('Model is not prepared');
    const probe = this.stateValue.environment?.runtime;
    return {
      state: () => client.state(),
      probe: () => probe ?? runtimeProbe(),
      install: (signal, onProgress) => client.install(signal, onProgress),
      load: (signal, onProgress) => client.load(signal, onProgress),
      generateCandidates: (request, signal) => {
        this.setModelState(client.state());
        return client.generateCandidates(request, signal);
      },
      composeClues: (request, signal) => client.composeClues(request, signal),
      unload: () => client.unload(),
    };
  }

  private async generate(): Promise<StageOutcome> {
    const recipe = this.stateValue.recipe;
    const request: CandidateRequest = {
      seed: recipe.seed,
      audienceSummary: recipe.audienceSummary,
      requestedRoles: recipe.requestedRoles,
      excludedAnswers: [],
      maxSuggestions: recipe.maxSuggestions,
      focus: recipe.focus,
      targetLengths: [3],
    };
    const batches: CandidateBatchObservation[] = [];
    const generated = await generateCandidateBatches(
      this.brokerFacade(),
      request,
      recipe.candidateBatches,
      this.controller?.signal,
      (observation) => {
        batches.push(observation);
        this.event(
          'generate',
          'candidate-batch',
          observation.result.ok ? 'success' : 'error',
          {
            batch: observation.batch,
            seed: observation.request.seed,
            excludedCount: observation.request.excludedAnswers.length,
            suggestionCount: observation.result.ok
              ? observation.result.value.length
              : 0,
            error: observation.result.ok ? undefined : observation.result.error,
            surfaces: observation.result.ok
              ? observation.result.value.map((item) => item.surface)
              : [],
          },
        );
      },
    );
    if (!generated.ok) {
      const status =
        generated.error.code === 'cancelled' || this.controller?.signal.aborted
          ? 'cancelled'
          : 'failed';
      return {
        ok: false,
        status,
        outputSummary: `${generated.error.code}: ${generated.error.message}`,
        failure: generated.error,
        details: { batches },
      };
    }
    this.setState((state) => ({ ...state, suggestions: generated.value }));
    return {
      ok: true,
      outputSummary: `${generated.value.length} suggestions across ${batches.length} batch${batches.length === 1 ? '' : 'es'}`,
      details: {
        request: { ...request, seed: `${request.seed}:batch-1` },
        batches: batches.map((batch) => ({
          batch: batch.batch,
          request: batch.request,
          result: batch.result,
        })),
      },
    };
  }

  private async resolve(): Promise<StageOutcome> {
    const source: LabSourceLabel =
      this.stateValue.recipe.mode === 'fixture'
        ? 'fixture'
        : 'model suggestion';
    const decisions: CandidateDecision[] = [];
    const accepted = new Set<string>();
    for (const item of this.stateValue.suggestions) {
      const decision = resolveSuggestion(item, source, accepted);
      decisions.push(decision);
      if (decision.accepted) accepted.add(decision.normalizedAnswer);
      this.event(
        'resolve',
        'candidate-decision',
        decision.accepted ? 'success' : 'warning',
        {
          surface: item.surface,
          normalizedAnswer: decision.normalizedAnswer,
          accepted: decision.accepted,
          reason: decision.reason,
          source: decision.source,
        },
      );
    }
    for (const value of this.stateValue.recipe.manualCandidates
      .split(/[\n,;]/)
      .map((item) => item.trim())
      .filter(Boolean)) {
      const decision = resolveSuggestion(
        manualSuggestion(value),
        'owner supplied',
        accepted,
      );
      decisions.push(decision);
      if (decision.accepted) accepted.add(decision.normalizedAnswer);
      this.event(
        'resolve',
        'manual-candidate-decision',
        decision.accepted ? 'success' : 'warning',
        {
          surface: value,
          normalizedAnswer: decision.normalizedAnswer,
          accepted: decision.accepted,
          reason: decision.reason,
          source: 'owner supplied',
        },
      );
    }
    const candidates = decisions.flatMap((decision) =>
      decision.candidate ? [decision.candidate] : [],
    );
    this.setState((state) => ({
      ...state,
      candidateDecisions: decisions,
      acceptedCandidates: candidates,
    }));
    const counts = decisions.reduce<Record<string, number>>(
      (result, decision) => {
        result[decision.reason] = (result[decision.reason] ?? 0) + 1;
        return result;
      },
      {},
    );
    if (candidates.length === 0)
      return {
        ok: false,
        outputSummary: 'No accepted candidates remain',
        failure: {
          code: 'no-eligible-candidates',
          message: 'The lab fixture lexicon accepted no suggestion',
        },
        details: { decisions, counts },
      };
    return {
      ok: true,
      outputSummary: `${candidates.length} accepted; ${decisions.length - candidates.length} rejected`,
      details: { decisions, counts },
    };
  }

  private async fill(): Promise<StageOutcome> {
    const recipe = this.stateValue.recipe;
    const request = {
      ...MINI_TEMPLATE.fill,
      candidates: this.stateValue.acceptedCandidates,
      seed: numberSeed(recipe.seed),
      maxNodes: recipe.nodeBudget,
      qualityThreshold: recipe.qualityThreshold,
    };
    const client =
      this.dependencies.createFillClient?.() ??
      createBrowserConstructorWorker();
    this.fillClient = client;
    let lastProgressAt = -Infinity;
    let lastBestScore = Number.NEGATIVE_INFINITY;
    let latestProgress: FillProgress | undefined;
    const onProgress = (progress: FillProgress) => {
      latestProgress = progress;
      const now = this.now();
      const bestChanged = progress.bestScore !== lastBestScore;
      if (!recipe.verboseTrace && now - lastProgressAt < 120 && !bestChanged)
        return;
      lastProgressAt = now;
      lastBestScore = progress.bestScore;
      this.setState((state) => ({
        ...state,
        fill: state.fill
          ? { ...state.fill, progress }
          : {
              request: {
                slotCount: request.slots.length,
                intersectionCount: request.intersections.length,
                nodeBudget: request.maxNodes,
              },
              result: {
                status: 'failed',
                failure: {
                  code: 'resource-limit',
                  message: 'Fill is still running',
                  nodes: progress.nodes,
                },
              },
              progress,
            },
      }));
      this.event('fill', 'fill-progress', 'info', {
        nodes: progress.nodes,
        assigned: progress.assigned,
        openSlots: progress.openSlots,
        bestScore: progress.bestScore,
      });
    };
    this.event(
      'fill',
      'fill-start',
      'info',
      {
        slotCount: request.slots.length,
        intersectionCount: request.intersections.length,
        nodeBudget: request.maxNodes,
        qualityThreshold: request.qualityThreshold,
      },
      { jobId: 'constructor-pending' },
    );
    const result = await client.solve(request, {
      signal: this.controller?.signal,
      onProgress,
    });
    latestProgress = latestProgress ?? undefined;
    const grid =
      result.status === 'solved' && result.solution
        ? projectSolutionToGrid(result.solution)
        : undefined;
    const evidence: FillEvidence = {
      request: {
        slotCount: request.slots.length,
        intersectionCount: request.intersections.length,
        nodeBudget: request.maxNodes,
        qualityThreshold: request.qualityThreshold,
        seed: request.seed,
        candidates: request.candidates.map((candidate) => ({
          word: candidate.word,
          score: candidate.score,
          sourceIds: candidate.sourceIds,
        })),
      },
      result,
      progress: latestProgress,
      grid,
    };
    this.setState((state) => ({
      ...state,
      fill: evidence,
      grid: grid ?? state.grid,
      modelState: state.modelState,
    }));
    if (result.status === 'solved' && result.solution) {
      this.event('fill', 'assignment', 'success', {
        score: result.solution.score,
        nodes: result.solution.nodes,
        assignments: Object.fromEntries(
          Object.entries(result.solution.assignments).map(
            ([slotId, candidate]) => [
              slotId,
              { word: candidate.word, sourceIds: candidate.sourceIds },
            ],
          ),
        ),
      });
      return {
        ok: true,
        outputSummary: `Solved at score ${result.solution.score.toFixed(2)} in ${result.solution.nodes} nodes`,
        details: evidence,
      };
    }
    const failure = result.failure ?? {
      code: 'unsatisfiable',
      message: 'The fill engine returned no solution',
      nodes: latestProgress?.nodes ?? 0,
    };
    const cancelled =
      failure.code === 'cancelled' || this.controller?.signal.aborted;
    this.event('fill', 'fill-failure', cancelled ? 'warning' : 'error', {
      code: failure.code,
      message: failure.message,
      nodes: failure.nodes,
    });
    return {
      ok: false,
      status: cancelled ? 'cancelled' : 'failed',
      outputSummary: `${failure.code}: ${failure.message}`,
      failure,
      details: evidence,
    };
  }

  private async clues(): Promise<StageOutcome> {
    const solution = this.stateValue.fill?.result;
    if (!solution || solution.status !== 'solved' || !solution.solution)
      return {
        ok: false,
        outputSummary: 'No valid fill is available for clue drafting',
        failure: {
          code: 'missing-fill',
          message: 'Clue drafting requires a solved fill',
        },
      };
    const byAnswer = new Map(
      this.stateValue.candidateDecisions
        .filter((item) => item.candidate)
        .map((item) => [item.normalizedAnswer, item]),
    );
    const drafts: ClueEvidence[] = [];
    const broker = this.brokerFacade();
    for (const [slotId, candidate] of Object.entries(
      solution.solution.assignments,
    ).sort(([left], [right]) => left.localeCompare(right))) {
      const decision = byAnswer.get(candidate.word.trim().toUpperCase());
      const intendedSense =
        decision?.suggestion.intendedSense ??
        getFixtureEntry(candidate.word)?.intendedSense ??
        'Unresolved intended sense';
      const source =
        decision?.source ??
        (this.stateValue.recipe.mode === 'fixture'
          ? 'fixture'
          : 'model suggestion');
      const result = await broker.composeClues(
        { answer: candidate.word, intendedSense },
        this.controller?.signal,
      );
      if (!result.ok) {
        const cancelled =
          result.error.code === 'cancelled' || this.controller?.signal.aborted;
        this.setState((state) => ({ ...state, clues: drafts }));
        return {
          ok: false,
          status: cancelled ? 'cancelled' : 'failed',
          outputSummary: `${result.error.code}: ${result.error.message}`,
          failure: result.error,
          details: { drafts },
        };
      }
      const evidence: ClueEvidence = {
        slotId,
        answer: candidate.word,
        source,
        intendedSense,
        drafts: result.value,
      };
      drafts.push(evidence);
      this.event('clues', 'clue-draft', 'success', {
        slotId,
        answer: candidate.word,
        source,
        draftCount: result.value.length,
        mechanisms: result.value.map((draft) => draft.mechanism),
      });
      this.setState((state) => ({ ...state, clues: [...drafts] }));
    }
    return {
      ok: true,
      outputSummary: `${drafts.length} experimental clue sets drafted`,
      details: { drafts },
    };
  }

  private review(): StageOutcome {
    const report = this.makeReport();
    this.setState((state) => ({ ...state, report }));
    this.event('review', 'report-ready', 'success', {
      runId: report.runId,
      caveatCount: report.caveats.length,
      eventCount: report.events.length,
    });
    return {
      ok: true,
      outputSummary:
        'Report assembled; never publishable or editorially approved',
      details: { caveats: report.caveats, runId: report.runId },
    };
  }

  private makeReport(): LabReport {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runId: this.stateValue.runId,
      mode: this.stateValue.recipe.mode,
      recipe: this.stateValue.recipe,
      template: {
        id: MINI_TEMPLATE.id,
        version: MINI_TEMPLATE.version,
        width: MINI_TEMPLATE.width,
        height: MINI_TEMPLATE.height,
        slots: MINI_TEMPLATE.slots,
        intersections: MINI_TEMPLATE.intersections,
      },
      stages: this.stateValue.stages,
      candidateDecisions: this.stateValue.candidateDecisions,
      fill: this.stateValue.fill,
      clues: this.stateValue.clues,
      events: this.stateValue.events,
      droppedEventCount: this.stateValue.droppedEventCount,
      environment: this.stateValue.environment,
      feedback: this.stateValue.feedback,
      caveats: [
        'This is an experimental mini fill, not a validated daily puzzle.',
        this.stateValue.recipe.mode === 'fixture'
          ? 'Fixture mode uses a simulated model and synthetic data.'
          : 'Local-model output is only accepted when it matches the synthetic fixture lexicon.',
        'Clue drafts are experimental and are not editorially approved.',
      ],
    };
  }

  private async execute(stageId: StageId): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    const startedAtMs = this.now();
    this.setState((state) => ({ ...state, currentStage: stageId }));
    this.updateStage(stageId, {
      status: 'running',
      startedAtMs,
      endedAtMs: undefined,
      durationMs: undefined,
      failure: undefined,
    });
    this.event(stageId, 'stage-start', 'info', {
      label: STAGE_LABELS[stageId],
    });
    let outcome: StageOutcome;
    try {
      outcome =
        stageId === 'prepare'
          ? await this.prepare()
          : stageId === 'generate'
            ? await this.generate()
            : stageId === 'resolve'
              ? await this.resolve()
              : stageId === 'fill'
                ? await this.fill()
                : stageId === 'clues'
                  ? await this.clues()
                  : this.review();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unexpected lab stage error';
      outcome = {
        ok: false,
        outputSummary: message,
        failure: { code: 'stage-error', message },
        status: controller.signal.aborted ? 'cancelled' : 'failed',
      };
    }
    const endedAtMs = this.now();
    const status: StageStatus = outcome.ok
      ? 'passed'
      : (outcome.status ?? 'failed');
    this.updateStage(stageId, {
      status,
      endedAtMs,
      durationMs: endedAtMs - startedAtMs,
      outputSummary: outcome.outputSummary,
      details: outcome.details,
      failure: outcome.failure,
    });
    this.event(
      stageId,
      'stage-end',
      outcome.ok ? 'success' : status === 'cancelled' ? 'warning' : 'error',
      {
        status,
        durationMs: endedAtMs - startedAtMs,
        outputSummary: outcome.outputSummary,
        failure: outcome.failure,
      },
    );
    if (stageId === 'prepare')
      this.setModelState(
        this.model?.state() ?? this.modelClient?.state() ?? 'uninstalled',
      );
    this.controller = undefined;
    this.setState((state) => ({ ...state, currentStage: undefined }));
  }

  public async runNext(): Promise<boolean> {
    if (this.controller) return false;
    const index = STAGE_IDS.findIndex(
      (id) => this.stateValue.stages[id].status === 'idle',
    );
    if (
      index < 0 ||
      STAGE_IDS.slice(0, index).some(
        (id) => this.stateValue.stages[id].status !== 'passed',
      )
    )
      return false;
    await this.execute(STAGE_IDS[index]!);
    return true;
  }

  public async runAll(): Promise<void> {
    while (await this.runNext()) {
      if (
        this.stateValue.stages[
          STAGE_IDS.find(
            (id) =>
              this.stateValue.stages[id].status === 'failed' ||
              this.stateValue.stages[id].status === 'cancelled',
          ) ?? 'prepare'
        ].status === 'failed'
      )
        break;
    }
  }

  public cancel(): void {
    this.controller?.abort();
    if (this.fillClient && this.stateValue.currentStage === 'fill')
      this.fillClient.cancel('constructor-active');
  }

  private releaseWorkers(): void {
    this.modelClient?.dispose();
    this.fillClient?.dispose();
    this.modelClient = undefined;
    this.fillClient = undefined;
    this.model = undefined;
  }

  public reset(recipe = this.stateValue.recipe): void {
    if (this.controller) this.cancel();
    const historical = stageSnapshot(this.stateValue);
    this.releaseWorkers();
    this.sequence = 0;
    this.stateValue = {
      runId: this.makeId(),
      recipe,
      stages: initialStages(),
      modelState: 'uninstalled',
      suggestions: [],
      candidateDecisions: [],
      acceptedCandidates: [],
      clues: [],
      feedback: this.stateValue.feedback,
      events: [],
      droppedEventCount: 0,
      historical,
    };
    this.notify();
  }

  public setFeedback(feedback: LabFeedback): void {
    this.setState((state) => ({ ...state, feedback }));
  }

  public exportReport(options: { includeRawDebug?: boolean } = {}): LabReport {
    const report = this.makeReport();
    if (!options.includeRawDebug) return report;
    return { ...report, recipe: { ...report.recipe, includeRawDebug: true } };
  }

  public dispose(): void {
    this.cancel();
    this.releaseWorkers();
    this.listeners.clear();
  }
}

export function createLabRunner(
  recipe = DEFAULT_RECIPE,
  dependencies: LabRunnerDependencies = {},
): LabRunner {
  return new LabRunnerImpl(recipe, dependencies);
}

export function createTestFixtureFillClient(
  solve: (
    request: Parameters<ConstructorWorkerClient['solve']>[0],
    options: Parameters<ConstructorWorkerClient['solve']>[1],
  ) => Promise<FillResult>,
): ConstructorWorkerClient {
  return {
    solve,
    cancel: () => undefined,
    dispose: () => undefined,
  };
}

export function fixtureSolution(): FillSolution {
  const assignments = Object.fromEntries(
    Object.entries(fixtureCrossingWords()).map(([slotId, word]) => [
      slotId,
      candidateFromEntry(getFixtureEntry(word)!),
    ]),
  );
  return { assignments, score: 5.31, nodes: 1 };
}

export function createFixtureBrokerForTests(): ModelBroker {
  return createModelBroker(
    {
      ...PINNED_DEV_MANIFEST,
      id: 'fixture-simulated-model',
      version: '1.0.0',
      runtimeVersion: 'fixture-runtime',
      promptVersion: 'fixture-v1',
      minimumMemoryMb: 1,
    },
    createFakeLocalModelAdapter({ suggestions: FIXTURE_SUGGESTIONS }),
    {
      webgpu: true,
      availableMemoryMb: 8192,
      storageQuotaBytes: 1,
      storageUsageBytes: 0,
    },
  );
}
