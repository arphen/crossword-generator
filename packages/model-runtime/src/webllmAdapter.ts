import type {
  CandidateRequest,
  CandidateRole,
  CandidateSuggestion,
  LocalModelAdapter,
  ModelManifest
} from './broker';

export type WebLlmModule = typeof import('@mlc-ai/web-llm');

export type WebLlmEngine = Awaited<ReturnType<WebLlmModule['CreateWebWorkerMLCEngine']>>;

export type WebLlmModuleLoader = () => Promise<WebLlmModule>;
export type WebLlmWorkerFactory = () => Worker;
export type WebLlmEngineFactory = (
  modelId: string,
  onProgress: (progress: number, text: string) => void
) => Promise<WebLlmEngine>;

export type WebLlmAdapterOptions = Readonly<{
  loadModule?: WebLlmModuleLoader;
  createWorker?: WebLlmWorkerFactory;
  createEngine?: WebLlmEngineFactory;
  temperature?: number;
}>;

const candidateRoles: readonly CandidateRole[] = ['theme', 'long', 'general', 'glue', 'stretch'];
const clueMechanisms = ['direct', 'standard', 'oblique', 'nudge'] as const;
const MAX_TEXT_LENGTH = 500;

function jsonValue(value: string): unknown {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function looseCandidate(surface: string, role: CandidateRole) {
  return {
    surface,
    intendedSense: 'Unresolved model association',
    associations: [],
    role,
    confidence: 0.2
  };
}

function normalizedRole(value: unknown, fallback: CandidateRole): CandidateRole {
  return typeof value === 'string' && candidateRoles.includes(value as CandidateRole)
    ? value as CandidateRole
    : fallback;
}

function normalizedConfidence(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(1, value));
  if (typeof value === 'string') {
    if (/^high$/i.test(value)) return 0.8;
    if (/^medium$/i.test(value)) return 0.5;
    if (/^low$/i.test(value)) return 0.2;
  }
  return 0.2;
}

function normalizedDifficulty(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(1, value));
  return 0.4;
}

function normalizedMechanism(value: unknown): 'direct' | 'standard' | 'oblique' | 'nudge' {
  return typeof value === 'string' && clueMechanisms.includes(value as typeof clueMechanisms[number])
    ? value as typeof clueMechanisms[number]
    : 'standard';
}

function looseCandidates(value: string, request: CandidateRequest): CandidateSuggestion[] {
  const role = request.requestedRoles[0] ?? 'general';
  return value
    .split(/[\r\n,;]/)
    .map((line) => line
      .replace(/^\s*[-*+]\s*/, '')
      .replace(/^\s*\d+[.)]\s*/, '')
      .replace(/^["'`([{]+|["'`\])}]+$/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[.!?:]+$/, '')
      .trim())
    .filter((surface) => {
      const fillLength = surface.replace(/[^A-Za-z]/g, '').length;
      return /^[A-Za-z][A-Za-z' -]*$/.test(surface)
        && fillLength >= 3
        && fillLength <= 15
        && !/^(candidate|surface|word|answer|list|error)$/i.test(surface);
    })
    .slice(0, request.maxSuggestions)
    .map((surface) => looseCandidate(surface, role));
}

function candidateOutput(value: string, request: CandidateRequest): unknown {
  const parsed = jsonValue(value);
  const items: unknown[] | undefined = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && Array.isArray((parsed as Record<string, unknown>).candidates)
      ? (parsed as Record<string, unknown>).candidates as unknown[]
      : undefined;
  if (!items) return looseCandidates(value, request);
  const role = request.requestedRoles[0] ?? 'general';
  return items.flatMap((item: unknown) => {
    if (typeof item === 'string') return [looseCandidate(item.trim(), role)];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [item];
    const candidate = item as Record<string, unknown>;
    const surface = typeof candidate.surface === 'string'
      ? candidate.surface
      : typeof candidate.answer === 'string'
        ? candidate.answer
        : typeof candidate.word === 'string'
          ? candidate.word
          : undefined;
    if (!surface) return [item];
    return [{
      surface,
      intendedSense: typeof candidate.intendedSense === 'string' && candidate.intendedSense.length > 0 ? candidate.intendedSense : 'Unresolved model association',
      associations: Array.isArray(candidate.associations) ? candidate.associations.filter((association): association is string => typeof association === 'string') : [],
      role: normalizedRole(candidate.role, role),
      confidence: normalizedConfidence(candidate.confidence)
    }];
  }).slice(0, request.maxSuggestions);
}

function clueOutput(value: string): unknown {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) return parsed;
  return parsed.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
    const draft = item as Record<string, unknown>;
    if (typeof draft.text !== 'string') return item;
    return {
      mechanism: normalizedMechanism(draft.mechanism),
      text: draft.text,
      difficulty: normalizedDifficulty(draft.difficulty)
    };
  });
}

function candidatePrompt(request: CandidateRequest): string {
  return [
    'Return JSON only: an array of crossword candidate objects.',
    'Each object must contain surface, intendedSense, associations, role, and confidence.',
    'Prefer real answer surfaces suitable for a crossword; do not return clues or prose.',
    `Seed: ${request.seed}`,
    `Audience: ${request.audienceSummary}`,
    `Roles: ${request.requestedRoles.join(', ')}`,
    `Focus: ${request.focus ?? 'broad language, culture, science, history, and playful word intelligence'}`,
    `Target lengths: ${request.targetLengths?.join(', ') ?? 'mixed'}`,
    `Excluded answers: ${request.excludedAnswers.join(', ') || 'none'}`,
    `Maximum candidates: ${request.maxSuggestions}`
  ].join('\n');
}

function cluePrompt(request: Readonly<{ answer: string; intendedSense: string }>): string {
  return [
    'Return JSON only: an array of crossword clue draft objects.',
    'Each object must contain mechanism (one of direct, standard, oblique, nudge), text, and difficulty (0 to 1).',
    `Answer: ${request.answer}`,
    `Intended sense: ${request.intendedSense}`
  ].join('\n');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Local model operation cancelled');
}

/**
 * In-browser adapter (ADR 0002). WebLLM's engine protocol requires a Worker
 * handle, so the broker worker spawns a nested engine worker running
 * WebWorkerMLCEngineHandler; weights are downloaded by the WebLLM runtime
 * into browser storage at install time and cached there. No HTTP inference
 * endpoint exists anywhere in the deployable graph.
 */
export function createWebLLMAdapter(options: WebLlmAdapterOptions = {}): LocalModelAdapter {
  const loadModule = options.loadModule ?? ((): Promise<WebLlmModule> => import('@mlc-ai/web-llm'));
  const createWorker = options.createWorker ?? ((): Worker => new Worker(new URL('./llmEngineWorker.ts', import.meta.url), { type: 'module' }));
  const createEngine = options.createEngine ?? (async (modelId, onProgress) => {
    const module = await loadModule();
    return module.CreateWebWorkerMLCEngine(createWorker(), modelId, {
      initProgressCallback: (report) => onProgress(report.progress, report.text)
    });
  });
  const temperature = options.temperature ?? 0.8;
  let engine: WebLlmEngine | null = null;

  async function complete(prompt: string, maxTokens: number, signal?: AbortSignal): Promise<string> {
    if (!engine) throw new Error('Local model is not loaded');
    throwIfAborted(signal);
    const onAbort = () => engine?.interruptGenerate();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const completion = await engine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens,
        stream: false
      });
      throwIfAborted(signal);
      const content = completion.choices[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    } catch (error) {
      if (signal?.aborted) throw new Error('Local model operation cancelled');
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    async install(manifest: ModelManifest, signal) {
      throwIfAborted(signal);
      const module = await loadModule();
      const known = module.prebuiltAppConfig.model_list.some((record) => record.model_id === manifest.id);
      if (!known) throw new Error(`Pinned model ${manifest.id} is not in the WebLLM prebuilt catalog`);
      engine = await createEngine(manifest.id, () => undefined);
    },
    async load(manifest: ModelManifest, signal) {
      throwIfAborted(signal);
      if (!engine) engine = await createEngine(manifest.id, () => undefined);
    },
    async generateCandidates(request: CandidateRequest, signal) {
      const text = await complete(candidatePrompt(request), 2048, signal);
      return candidateOutput(text, request);
    },
    async composeClues(request, signal) {
      const text = await complete(cluePrompt(request), 512, signal);
      return clueOutput(text);
    },
    async unload() {
      if (!engine) return;
      const current = engine;
      engine = null;
      await current.unload();
    }
  };
}
