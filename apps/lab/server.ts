import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const engineDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../vendor/xfill',
);
const binaryDirectory = path.join(engineDirectory, 'target', 'release');
const wordlist = path.join(engineDirectory, 'data', 'xwordlist.dict');
const ollama = 'http://127.0.0.1:11434';
let buildPromise: Promise<void> | undefined;
let generating = false;
let activeGeneration: AbortController | undefined;

export type GenerateOptions = {
  seed: number;
  candidates: number;
  time: number;
  keepMean: number;
  minScore: number;
  maxIffy: number;
  themes: string[];
};

export function parseGenerateOptions(value: unknown): GenerateOptions {
  if (!value || typeof value !== 'object')
    throw new Error('Missing generation options');
  const input = value as Record<string, unknown>;
  const integer = (key: string, min: number, max: number, fallback: number) => {
    const raw = input[key] ?? fallback;
    if (
      !Number.isInteger(raw) ||
      (raw as number) < min ||
      (raw as number) > max
    )
      throw new Error(`${key} must be an integer from ${min} to ${max}`);
    return raw as number;
  };
  const time = input.time ?? 1.5;
  if (
    typeof time !== 'number' ||
    !Number.isFinite(time) ||
    time < 0.25 ||
    time > 10
  )
    throw new Error('time must be between 0.25 and 10 seconds');
  const themes = input.themes ?? [];
  if (
    !Array.isArray(themes) ||
    themes.length > 4 ||
    themes.some(
      (item) =>
        typeof item !== 'string' ||
        !/^[A-Z]{3,15}$/.test(item) ||
        item.length === 12,
    )
  )
    throw new Error(
      'Use up to four A–Z theme answers, 3–15 letters, excluding 12',
    );
  return {
    seed: integer('seed', 0, 2_147_483_647, 1),
    candidates: integer('candidates', 10, 400, 80),
    time,
    keepMean: integer('keepMean', 50, 95, 78),
    minScore: integer('minScore', 40, 80, 60),
    maxIffy: integer('maxIffy', 0, 20, 0),
    themes,
  };
}

export type GeneratedEntry = {
  num: number;
  dir: 'A' | 'D';
  row: number;
  col: number;
  len: number;
  answer: string;
  score: number;
  theme: boolean;
};

export type GeneratedGrid = {
  id: number;
  blocks: number;
  themed: boolean;
  mean_score: number;
  min_score: number;
  iffy: number;
  weak: number;
  template: string[];
  fill: string[];
  entries: GeneratedEntry[];
};

export function validateGeneratedGrid(value: unknown): GeneratedGrid {
  if (!value || typeof value !== 'object')
    throw new Error('Engine returned no grid');
  const grid = value as GeneratedGrid;
  if (
    !Array.isArray(grid.fill) ||
    grid.fill.length !== 15 ||
    grid.fill.some(
      (row) => typeof row !== 'string' || !/^[A-Z#]{15}$/.test(row),
    ) ||
    !Array.isArray(grid.template) ||
    grid.template.length !== 15 ||
    grid.template.some(
      (row) => typeof row !== 'string' || !/^[.#A-Z]{15}$/.test(row),
    ) ||
    !Array.isArray(grid.entries) ||
    grid.entries.length < 50 ||
    grid.entries.length > 78
  )
    throw new Error('Engine returned a non-standard 15×15 grid');
  const seen = new Set<string>();
  let blockCount = 0;
  const whiteCells: string[] = [];
  for (let row = 0; row < 15; row += 1)
    for (let col = 0; col < 15; col += 1) {
      const blocked = grid.template[row]![col] === '#';
      if (blocked) blockCount += 1;
      else whiteCells.push(`${row},${col}`);
      if ((grid.fill[row]![col] === '#') !== blocked)
        throw new Error('Block mismatch');
      if (blocked && grid.template[14 - row]![14 - col] !== '#')
        throw new Error('Blocks are not rotationally symmetric');
    }
  if (blockCount !== grid.blocks)
    throw new Error('Block count does not match grid');
  const visited = new Set<string>();
  const queue = [whiteCells[0]!];
  while (queue.length) {
    const cell = queue.pop()!;
    if (visited.has(cell)) continue;
    visited.add(cell);
    const [row, col] = cell.split(',').map(Number) as [number, number];
    for (const [nextRow, nextCol] of [
      [row - 1, col],
      [row + 1, col],
      [row, col - 1],
      [row, col + 1],
    ] as [number, number][]) {
      if (grid.fill[nextRow]?.[nextCol] && grid.fill[nextRow]![nextCol] !== '#')
        queue.push(`${nextRow},${nextCol}`);
    }
  }
  if (visited.size !== whiteCells.length)
    throw new Error('White cells are disconnected');
  const covered = new Map<string, Set<'A' | 'D'>>();
  for (const entry of grid.entries) {
    if (
      !Number.isInteger(entry.num) ||
      !Number.isInteger(entry.row) ||
      !Number.isInteger(entry.col) ||
      !Number.isInteger(entry.len) ||
      !['A', 'D'].includes(entry.dir) ||
      !/^[A-Z]{3,15}$/.test(entry.answer) ||
      entry.answer.length !== entry.len ||
      seen.has(entry.answer)
    )
      throw new Error('Invalid or repeated entry');
    seen.add(entry.answer);
    const beforeRow = entry.row - (entry.dir === 'D' ? 1 : 0);
    const beforeCol = entry.col - (entry.dir === 'A' ? 1 : 0);
    const afterRow = entry.row + (entry.dir === 'D' ? entry.len : 0);
    const afterCol = entry.col + (entry.dir === 'A' ? entry.len : 0);
    if (
      (grid.fill[beforeRow]?.[beforeCol] &&
        grid.fill[beforeRow]![beforeCol] !== '#') ||
      (grid.fill[afterRow]?.[afterCol] &&
        grid.fill[afterRow]![afterCol] !== '#')
    )
      throw new Error('Entry does not span a complete slot');
    const letters = [...entry.answer]
      .map(
        (_, offset) =>
          grid.fill[entry.row + (entry.dir === 'D' ? offset : 0)]?.[
            entry.col + (entry.dir === 'A' ? offset : 0)
          ],
      )
      .join('');
    if (letters !== entry.answer)
      throw new Error('Entry does not match crossings');
    for (let offset = 0; offset < entry.len; offset += 1) {
      const row = entry.row + (entry.dir === 'D' ? offset : 0);
      const col = entry.col + (entry.dir === 'A' ? offset : 0);
      const key = `${row},${col}`;
      const directions = covered.get(key) ?? new Set<'A' | 'D'>();
      if (directions.has(entry.dir))
        throw new Error('Overlapping entries in one direction');
      directions.add(entry.dir);
      covered.set(key, directions);
    }
  }
  for (let row = 0; row < 15; row += 1)
    for (let col = 0; col < 15; col += 1)
      if (
        grid.fill[row]![col] !== '#' &&
        covered.get(`${row},${col}`)?.size !== 2
      )
        throw new Error('Every white cell must have Across and Down entries');
  return grid;
}

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const abort = () => child.kill('SIGTERM');
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16_000);
      });
    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Error('Generation cancelled'));
      if (code === 0) resolve(output);
      else
        reject(
          new Error(
            `${command} exited ${code ?? 'after timeout'}: ${output.slice(-1200)}`,
          ),
        );
    });
  });
}

async function ensureBuilt(): Promise<void> {
  buildPromise ??= run(
    'cargo',
    ['build', '--release'],
    engineDirectory,
    180_000,
  )
    .then(() => undefined)
    .catch((error) => {
      buildPromise = undefined;
      throw error;
    });
  await buildPromise;
}

async function generate(
  options: GenerateOptions,
  signal: AbortSignal,
): Promise<GeneratedGrid> {
  await ensureBuilt();
  if (signal.aborted) throw new Error('Generation cancelled');
  const temporary = await mkdtemp(path.join(tmpdir(), 'crossword-lab-'));
  const output = path.join(temporary, 'library.json');
  try {
    const themed = options.themes.length > 0;
    const args = themed
      ? [
          ...options.themes.flatMap((answer) => ['--theme', answer]),
          '--blocks',
          '44',
          '--max-words',
          '78',
        ]
      : ['--min-words', '72', '--max-words', '78'];
    await run(
      path.join(binaryDirectory, themed ? 'theme' : 'library'),
      [
        ...args,
        '--wordlist',
        wordlist,
        '--candidates',
        String(options.candidates),
        '--time',
        String(options.time),
        '--keep-mean',
        String(options.keepMean),
        '--min-score',
        String(options.minScore),
        '--max-iffy',
        String(options.maxIffy),
        '--top',
        '3',
        '--seed',
        String(options.seed),
        '--out',
        output,
      ],
      engineDirectory,
      180_000,
      signal,
    );
    const library = JSON.parse(await readFile(output, 'utf8')) as {
      grids?: unknown[];
    };
    if (!library.grids?.length)
      throw new Error(
        'No fill met the quality gates; try more candidates or a different seed',
      );
    return validateGeneratedGrid(library.grids[0]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > 16_384) throw new Error('Request body is too large');
  }
  return JSON.parse(body);
}

function respond(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

export function isLocalRequest(host: string, origin?: string): boolean {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return false;
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function models(): Promise<string[]> {
  const response = await fetch(`${ollama}/api/tags`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  const data = (await response.json()) as { models?: { name?: string }[] };
  return (data.models ?? []).flatMap((item) => (item.name ? [item.name] : []));
}

async function clue(value: unknown): Promise<{ model: string; text: string }> {
  if (!value || typeof value !== 'object')
    throw new Error('Missing clue request');
  const input = value as Record<string, unknown>;
  if (
    typeof input.model !== 'string' ||
    typeof input.answer !== 'string' ||
    !/^[A-Z]{3,15}$/.test(input.answer) ||
    typeof input.style !== 'string' ||
    input.style.length > 120
  )
    throw new Error('Invalid clue request');
  const available = await models();
  if (!available.includes(input.model))
    throw new Error('Selected Ollama model is not installed');
  const response = await fetch(`${ollama}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: input.model,
      stream: false,
      format: 'json',
      think: false,
      options: { temperature: 0.5, num_predict: 200 },
      prompt: `Write ONE fair American crossword clue for ${input.answer}. Style: ${input.style || 'medium difficulty'}. Keep it under 12 words. Do not include the answer itself. Reply with a JSON object containing only a clue property.`,
    }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  const data = (await response.json()) as {
    response?: string;
    done_reason?: string;
  };
  if (data.done_reason === 'length')
    throw new Error('Model ran out of output tokens before finishing its clue');
  const parsed = JSON.parse(data.response ?? '{}') as { clue?: unknown };
  const text = typeof parsed.clue === 'string' ? parsed.clue.trim() : '';
  if (
    text.length < 3 ||
    text.length > 180 ||
    text
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .includes(input.answer)
  )
    throw new Error('Model did not return an acceptable clue draft');
  return { model: input.model, text };
}

async function themeIdeas(
  value: unknown,
): Promise<{ model: string; answers: string[] }> {
  if (!value || typeof value !== 'object')
    throw new Error('Missing theme request');
  const input = value as Record<string, unknown>;
  if (
    typeof input.model !== 'string' ||
    typeof input.focus !== 'string' ||
    !input.focus.trim() ||
    input.focus.length > 120
  )
    throw new Error('Choose a model and a theme topic under 120 characters');
  if (!(await models()).includes(input.model))
    throw new Error('Selected Ollama model is not installed');
  const response = await fetch(`${ollama}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: input.model,
      stream: false,
      format: 'json',
      think: false,
      options: { temperature: 0.7, num_predict: 250 },
      prompt: `Suggest exactly three cohesive American crossword theme answers about: ${input.focus}. Each answer should be a familiar phrase or word, 7–11 letters after removing spaces. All three should share a clear theme mechanism. Return JSON only: {"answers":["first","second","third"]}. No explanations.`,
    }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  const data = (await response.json()) as {
    response?: string;
    done_reason?: string;
  };
  if (data.done_reason === 'length')
    throw new Error('Model ran out of output tokens');
  const parsed = JSON.parse(data.response ?? '{}') as { answers?: unknown };
  if (
    !Array.isArray(parsed.answers) ||
    parsed.answers.length !== 3 ||
    parsed.answers.some((item) => typeof item !== 'string')
  )
    throw new Error('Model did not return three theme answers');
  const answers = (parsed.answers as string[]).map((item) =>
    item.toUpperCase().replace(/[^A-Z]/g, ''),
  );
  if (
    answers.some((answer) => answer.length < 7 || answer.length > 11) ||
    new Set(answers).size !== 3
  )
    throw new Error(
      'Model returned theme answers with invalid lengths or duplicates',
    );
  return { model: input.model, answers };
}

export function labApi(): Plugin {
  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const url = req.url?.split('?')[0];
    if (!url?.startsWith('/api/lab/')) return next();
    if (!isLocalRequest(req.headers.host ?? '', req.headers.origin))
      return respond(res, 403, { error: 'The lab API is local-only' });
    try {
      if (url === '/api/lab/models' && req.method === 'GET') {
        const installed = await models().catch(() => []);
        return respond(res, 200, {
          models: installed,
          engine: 'xfill',
          size: 15,
        });
      }
      if (url === '/api/lab/generate' && req.method === 'POST') {
        if (generating)
          return respond(res, 409, {
            error: 'A generation job is already running',
          });
        const options = parseGenerateOptions(await readBody(req));
        generating = true;
        activeGeneration = new AbortController();
        try {
          const grid = await generate(options, activeGeneration.signal);
          return respond(res, 200, { grid, engine: 'xfill', options });
        } finally {
          generating = false;
          activeGeneration = undefined;
        }
      }
      if (url === '/api/lab/cancel' && req.method === 'POST') {
        activeGeneration?.abort();
        return respond(res, 200, { cancelled: Boolean(activeGeneration) });
      }
      if (url === '/api/lab/clue' && req.method === 'POST')
        return respond(res, 200, await clue(await readBody(req)));
      if (url === '/api/lab/theme-ideas' && req.method === 'POST')
        return respond(res, 200, await themeIdeas(await readBody(req)));
      return respond(res, 404, { error: 'Unknown lab route' });
    } catch (error) {
      return respond(res, 400, {
        error: error instanceof Error ? error.message : 'Lab request failed',
      });
    }
  };
  return {
    name: 'crossword-lab-local-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
