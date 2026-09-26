import { useEffect, useMemo, useState } from 'react';
import sample from './sample-grid.json';
import './full-size.css';

type Entry = {
  num: number;
  dir: 'A' | 'D';
  row: number;
  col: number;
  len: number;
  answer: string;
  score: number;
  theme: boolean;
};
type Grid = {
  blocks: number;
  mean_score: number;
  min_score: number;
  iffy: number;
  weak: number;
  template: string[];
  fill: string[];
  entries: Entry[];
};
type Draft = { model: string; text: string; at: string };
type ClueBook = Record<string, { final: string; drafts: Draft[] }>;
type ApiError = { error?: string };

const initialGrid = sample as Grid;
const savedKey = 'luna-full-size-session-v1';

function savedSession():
  | { grid: Grid; source: string; book: ClueBook }
  | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(savedKey) ?? 'null') as {
      grid?: Grid;
      source?: string;
      book?: ClueBook;
    } | null;
    if (
      value?.grid?.fill.length === 15 &&
      value.grid.fill.every((row) => row.length === 15) &&
      value.grid.entries.length >= 50 &&
      value.grid.entries.length <= 78 &&
      typeof value.source === 'string' &&
      value.book &&
      typeof value.book === 'object'
    )
      return { grid: value.grid, source: value.source, book: value.book };
  } catch {
    /* Browser storage is optional. */
  }
  return undefined;
}

function key(entry: Entry): string {
  return `${entry.num}${entry.dir}`;
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const result = (await response.json()) as T & ApiError;
  if (!response.ok)
    throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function download(name: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export default function FullSizeApp() {
  const [saved] = useState(savedSession);
  const [grid, setGrid] = useState<Grid>(saved?.grid ?? initialGrid);
  const [source, setSource] = useState(
    saved?.source ?? 'Bundled example · generated with xfill, seed 31',
  );
  const [selected, setSelected] = useState('1A');
  const [direction, setDirection] = useState<'A' | 'D'>('A');
  const [seed, setSeed] = useState(1);
  const [candidates, setCandidates] = useState(100);
  const [keepMean, setKeepMean] = useState(75);
  const [minScore, setMinScore] = useState(60);
  const [maxIffy, setMaxIffy] = useState(0);
  const [themes, setThemes] = useState('');
  const [themeFocus, setThemeFocus] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [chosenModels, setChosenModels] = useState<string[]>([]);
  const [style, setStyle] = useState(
    'medium difficulty; clean, precise, lively',
  );
  const [book, setBook] = useState<ClueBook>(saved?.book ?? {});
  const [running, setRunning] = useState<'fill' | 'clue' | 'theme' | null>(
    null,
  );
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(
    saved
      ? 'Your locally saved 15×15 grid and clue edits are ready.'
      : 'A complete 15×15 example is ready. Generate a fresh fill when you want to explore.',
  );
  const [showAnswers, setShowAnswers] = useState(true);

  useEffect(() => {
    api<{ models: string[] }>('/api/lab/models')
      .then((result) => {
        setModels(result.models);
        setChosenModels(result.models.length ? [result.models.at(-1)!] : []);
      })
      .catch(() =>
        setMessage(
          'The bundled puzzle is available. Start the local server to generate new fills or use Ollama.',
        ),
      );
  }, []);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => {
    try {
      localStorage.setItem(savedKey, JSON.stringify({ grid, source, book }));
    } catch {
      /* Export remains available without browser storage. */
    }
  }, [grid, source, book]);

  const entries = useMemo(
    () =>
      [...grid.entries].sort(
        (a, b) => a.dir.localeCompare(b.dir) || a.num - b.num,
      ),
    [grid],
  );
  const active =
    entries.find((entry) => key(entry) === selected) ?? entries[0]!;
  const activeKey = key(active);
  const activeCells = new Set(
    Array.from({ length: active.len }, (_, offset) =>
      cellKey(
        active.row + (active.dir === 'D' ? offset : 0),
        active.col + (active.dir === 'A' ? offset : 0),
      ),
    ),
  );
  const entryAt = (row: number, col: number, dir: 'A' | 'D') =>
    entries.find(
      (entry) =>
        entry.dir === dir &&
        (dir === 'A'
          ? entry.row === row && col >= entry.col && col < entry.col + entry.len
          : entry.col === col &&
            row >= entry.row &&
            row < entry.row + entry.len),
    );
  const startNumbers = new Map(
    entries.map((entry) => [cellKey(entry.row, entry.col), entry.num]),
  );
  const current = book[activeKey] ?? { final: '', drafts: [] };
  const completedClues = Object.values(book).filter((item) =>
    item.final.trim(),
  ).length;

  const generate = async () => {
    setRunning('fill');
    setElapsed(0);
    setError('');
    setMessage(
      'Generating and ranking real 15×15 fills. This can take a few seconds.',
    );
    try {
      const themeAnswers = themes
        .toUpperCase()
        .split(/[\s,;]+/)
        .filter(Boolean);
      const result = await api<{ grid: Grid }>('/api/lab/generate', {
        seed,
        candidates,
        time: themeAnswers.length ? 3 : 1.5,
        keepMean,
        minScore,
        maxIffy,
        themes: themeAnswers,
      });
      setGrid(result.grid);
      setBook({});
      setSelected(key(result.grid.entries[0]!));
      setSource(
        `Fresh xfill run · seed ${seed} · ${candidates} candidate shapes${themeAnswers.length ? ` · themes ${themeAnswers.join(', ')}` : ''}`,
      );
      setMessage(
        `Generated ${result.grid.entries.length} checked entries; mean score ${result.grid.mean_score.toFixed(1)}, ${result.grid.iffy} low-score entries.`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Generation failed',
      );
      setMessage('The previous complete grid is preserved.');
    } finally {
      setRunning(null);
    }
  };

  const draftClues = async () => {
    if (!chosenModels.length) return;
    setRunning('clue');
    setElapsed(0);
    setError('');
    setMessage(
      `Asking ${chosenModels.length} local model${chosenModels.length === 1 ? '' : 's'} to draft ${activeKey}.`,
    );
    const drafts: Draft[] = [];
    const failures: string[] = [];
    for (const model of chosenModels) {
      try {
        const result = await api<{ model: string; text: string }>(
          '/api/lab/clue',
          {
            model,
            answer: active.answer,
            style,
          },
        );
        drafts.push({ ...result, at: new Date().toISOString() });
      } catch (failure) {
        failures.push(
          `${model}: ${failure instanceof Error ? failure.message : 'failed'}`,
        );
      }
    }
    setBook((previous) => ({
      ...previous,
      [activeKey]: {
        final: previous[activeKey]?.final ?? '',
        drafts: [...(previous[activeKey]?.drafts ?? []), ...drafts],
      },
    }));
    setError(failures.join(' · '));
    setMessage(
      `${drafts.length} clue draft${drafts.length === 1 ? '' : 's'} saved for ${activeKey}. Check accuracy and edit the final clue.`,
    );
    setRunning(null);
  };

  const suggestThemes = async () => {
    const model = chosenModels[0];
    if (!model || !themeFocus.trim()) return;
    setRunning('theme');
    setElapsed(0);
    setError('');
    setMessage(`Asking ${model} for a cohesive theme set.`);
    try {
      const result = await api<{ model: string; answers: string[] }>(
        '/api/lab/theme-ideas',
        {
          model,
          focus: themeFocus.trim(),
        },
      );
      setThemes(result.answers.join(', '));
      setMessage(
        `Theme suggestions from ${result.model}: ${result.answers.join(', ')}. Review and edit them, then generate.`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Theme suggestion failed',
      );
    } finally {
      setRunning(null);
    }
  };

  const selectCell = (row: number, col: number) => {
    const chosen =
      entryAt(row, col, direction) ??
      entryAt(row, col, direction === 'A' ? 'D' : 'A');
    if (chosen) {
      setSelected(key(chosen));
      setDirection(chosen.dir);
    }
  };

  return (
    <div className="full-app">
      <header className="full-header">
        <div>
          <div className="kicker">LUNA / CONSTRUCTION STUDIO</div>
          <h1>Build the whole crossword.</h1>
          <p>
            15×15 construction, scored fill, and side-by-side local AI clue
            drafts. The grid is real; you remain the editor.
          </p>
        </div>
        <div className="header-badges">
          <span>15 × 15</span>
          <span>{grid.entries.length} entries</span>
          <span>{grid.blocks} blocks</span>
        </div>
      </header>

      <div className="full-workspace">
        <aside className="full-card controls">
          <div className="card-top">
            <div className="kicker">01 / FILL</div>
            <h2>Construction</h2>
          </div>
          <p className="small">
            A scored crossword lexicon and Rust fill engine explore symmetric
            grids, then return the strongest complete fill.
          </p>
          <label>
            Seed
            <input
              type="number"
              min="0"
              max="2147483647"
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value))}
            />
          </label>
          <label>
            Candidate grids
            <input
              type="number"
              min="10"
              max="400"
              value={candidates}
              onChange={(event) => setCandidates(Number(event.target.value))}
            />
          </label>
          <div className="two-inputs">
            <label>
              Mean score ≥
              <input
                type="number"
                min="50"
                max="95"
                value={keepMean}
                onChange={(event) => setKeepMean(Number(event.target.value))}
              />
            </label>
            <label>
              Iffy entries ≤
              <input
                type="number"
                min="0"
                max="20"
                value={maxIffy}
                onChange={(event) => setMaxIffy(Number(event.target.value))}
              />
            </label>
          </div>
          <label>
            Minimum entry score
            <input
              type="number"
              min="40"
              max="80"
              value={minScore}
              onChange={(event) => setMinScore(Number(event.target.value))}
            />
          </label>
          <label>
            Optional theme answers
            <textarea
              rows={2}
              value={themes}
              onChange={(event) => setThemes(event.target.value)}
              placeholder="One to four answers, separated by commas"
            />
          </label>
          <p className="hint">
            Theme entries: 3–15 letters, except 12. More candidates help
            constrained themes.
          </p>
          <label>
            Ask AI for a theme set
            <input
              value={themeFocus}
              onChange={(event) => setThemeFocus(event.target.value)}
              maxLength={120}
              placeholder="e.g. surprising sports phrases"
            />
          </label>
          <button
            className="secondary-action"
            disabled={
              Boolean(running) || !chosenModels.length || !themeFocus.trim()
            }
            onClick={() => void suggestThemes()}
          >
            {running === 'theme'
              ? `Thinking… ${elapsed}s`
              : 'Suggest 3 theme answers'}
          </button>
          <button
            className="primary-action"
            disabled={Boolean(running)}
            onClick={() => void generate()}
          >
            {running === 'fill'
              ? `Searching… ${elapsed}s`
              : 'Generate new 15×15'}
          </button>
          {running === 'fill' && (
            <button
              className="text-action cancel-action"
              onClick={() =>
                void api('/api/lab/cancel', {})
                  .then(() => setMessage('Cancelling the fill search…'))
                  .catch(() => setError('Could not cancel the fill search'))
              }
            >
              Cancel generation
            </button>
          )}
          <div className="divider" />
          <div className="kicker">02 / MODELS</div>
          <h2>Compare clues</h2>
          {models.length ? (
            <div className="model-list">
              {models.map((model) => (
                <label key={model} className="check-row">
                  <input
                    type="checkbox"
                    checked={chosenModels.includes(model)}
                    onChange={(event) =>
                      setChosenModels((old) =>
                        event.target.checked
                          ? [...old, model]
                          : old.filter((item) => item !== model),
                      )
                    }
                  />
                  <span>{model}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="hint">
              No Ollama models detected. The fill still works; install or start
              Ollama to compare clue drafts.
            </p>
          )}
          <label>
            Clue direction
            <input
              value={style}
              onChange={(event) => setStyle(event.target.value)}
              maxLength={120}
            />
          </label>
          <button
            className="secondary-action"
            disabled={Boolean(running) || !chosenModels.length}
            onClick={() => void draftClues()}
          >
            {running === 'clue'
              ? `Drafting… ${elapsed}s`
              : `Draft ${activeKey} with selected models`}
          </button>
          <div className="divider" />
          <button
            className="text-action"
            onClick={() =>
              download(`luna-15x15-${seed}.json`, {
                schemaVersion: 1,
                source,
                grid,
                clues: book,
              })
            }
          >
            Export grid + clues ↓
          </button>
          <p className="hint">
            The local model endpoint is 127.0.0.1:11434. Drafts are suggestions;
            no clue is marked final until you edit or choose one.
          </p>
        </aside>

        <main className="full-card puzzle-card">
          <div className="puzzle-top">
            <div>
              <div className="kicker">THE GRID</div>
              <h2>Crossword in progress</h2>
              <p className="source-line">{source}</p>
            </div>
            <button
              className="subtle-button"
              onClick={() => setShowAnswers(!showAnswers)}
            >
              {showAnswers ? 'Hide letters' : 'Show letters'}
            </button>
          </div>
          <div className="grid-frame">
            <div
              className="full-grid"
              role="grid"
              aria-label="15 by 15 crossword"
            >
              {grid.fill.map((line, row) =>
                [...line].map((letter, col) => {
                  const blocked = letter === '#';
                  const number = startNumbers.get(cellKey(row, col));
                  const highlighted = activeCells.has(cellKey(row, col));
                  return (
                    <button
                      key={`${row}-${col}`}
                      type="button"
                      role="gridcell"
                      disabled={blocked}
                      aria-label={
                        blocked
                          ? 'Black square'
                          : `Row ${row + 1}, column ${col + 1}${number ? `, ${number}` : ''}, ${showAnswers ? letter : 'hidden'}`
                      }
                      className={`full-cell ${blocked ? 'block' : ''} ${highlighted ? 'active' : ''}`}
                      onClick={() => selectCell(row, col)}
                    >
                      {!blocked && (
                        <>
                          <span className="cell-number">{number}</span>
                          <span className="cell-answer">
                            {showAnswers ? letter : ''}
                          </span>
                        </>
                      )}
                    </button>
                  );
                }),
              )}
            </div>
          </div>
          <div className="grid-footer">
            <div>
              <strong>{grid.mean_score.toFixed(1)}</strong>
              <span>mean fill score</span>
            </div>
            <div>
              <strong>{grid.min_score}</strong>
              <span>lowest entry</span>
            </div>
            <div>
              <strong>{grid.iffy}</strong>
              <span>iffy entries</span>
            </div>
            <div>
              <strong>
                {completedClues}/{grid.entries.length}
              </strong>
              <span>final clues</span>
            </div>
          </div>
          <div className="run-message" aria-live="polite">
            {running && <span className="pulse" />}
            {message}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <div className="entry-columns">
            {(['A', 'D'] as const).map((dir) => (
              <section key={dir}>
                <h3>{dir === 'A' ? 'Across' : 'Down'}</h3>
                <div className="entry-list">
                  {entries
                    .filter((entry) => entry.dir === dir)
                    .map((entry) => (
                      <button
                        key={key(entry)}
                        className={`entry-row ${selected === key(entry) ? 'selected' : ''}`}
                        onClick={() => {
                          setSelected(key(entry));
                          setDirection(dir);
                        }}
                      >
                        <strong>{entry.num}</strong>
                        <span>{entry.answer}</span>
                        <small>{entry.score}</small>
                      </button>
                    ))}
                </div>
              </section>
            ))}
          </div>
        </main>

        <aside className="full-card editor-card">
          <div className="card-top">
            <div className="kicker">03 / EDIT</div>
            <h2>Entry & clue</h2>
          </div>
          <div className="selected-meta">
            <span>
              {active.num} {active.dir === 'A' ? 'Across' : 'Down'}
            </span>
            <span>{active.len} letters</span>
            <span>score {active.score}</span>
          </div>
          <div className="selected-answer">{active.answer}</div>
          <p className="small">
            Starts row {active.row + 1}, column {active.col + 1}
            {active.theme ? ' · Theme entry' : ''}
          </p>
          <div className="divider" />
          <div className="draft-heading">
            <h3>Model drafts</h3>
            <span>{current.drafts.length}</span>
          </div>
          {current.drafts.length ? (
            current.drafts.map((draft, index) => (
              <div className="draft-card" key={`${draft.model}-${index}`}>
                <div className="draft-model">{draft.model}</div>
                <p>{draft.text}</p>
                <button
                  onClick={() =>
                    setBook((old) => ({
                      ...old,
                      [activeKey]: { ...current, final: draft.text },
                    }))
                  }
                >
                  Use as starting clue
                </button>
              </div>
            ))
          ) : (
            <p className="empty-drafts">
              Select one or more models, then draft this entry. You can also
              write a clue directly below.
            </p>
          )}
          <label>
            Final clue
            <textarea
              rows={5}
              value={current.final}
              onChange={(event) =>
                setBook((old) => ({
                  ...old,
                  [activeKey]: { ...current, final: event.target.value },
                }))
              }
              placeholder="Write or refine a fair clue…"
            />
          </label>
          <p className="hint">
            Saved locally and included in the JSON export. Verify definitions,
            ambiguity, and duplication before publication.
          </p>
        </aside>
      </div>
    </div>
  );
}
