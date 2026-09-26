import { useEffect, useMemo, useState } from 'react';
import { MINI_TEMPLATE } from './fixture';
import {
  EMPTY_FEEDBACK,
  LOCAL_MODEL_PROFILES,
  STAGE_IDS,
  createLabRunner,
  type LabFeedback,
  type LabRecipe,
  type LabSnapshot,
  type StageId,
} from './runner';
import './styles.css';

const FEEDBACK_STORAGE_KEY = 'crossword-generator-lab-feedback-v1';

function statusText(status: LabSnapshot['stages'][StageId]['status']): string {
  return status === 'passed' ? 'passed' : status;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function App() {
  const [runner] = useState(() => createLabRunner());
  const [snapshot, setSnapshot] = useState<LabSnapshot>(() =>
    runner.snapshot(),
  );
  const [draft, setDraft] = useState<LabRecipe>(() => runner.snapshot().recipe);
  const [selectedSlot, setSelectedSlot] = useState('A1');
  const [diagnosticTab, setDiagnosticTab] = useState<
    'summary' | 'events' | 'data'
  >('summary');
  const [eventFilter, setEventFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [latestFirst, setLatestFirst] = useState(true);
  const [expanded, setExpanded] = useState<StageId | undefined>('prepare');
  const [busy, setBusy] = useState(false);

  useEffect(() => runner.subscribe(setSnapshot), [runner]);
  useEffect(() => () => runner.dispose(), [runner]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FEEDBACK_STORAGE_KEY);
      if (saved)
        runner.setFeedback({
          ...EMPTY_FEEDBACK,
          ...(JSON.parse(saved) as Partial<LabFeedback>),
        });
    } catch {
      // Feedback is optional; private browser storage can be unavailable.
    }
  }, [runner]);
  useEffect(() => {
    try {
      localStorage.setItem(
        FEEDBACK_STORAGE_KEY,
        JSON.stringify(snapshot.feedback),
      );
    } catch {
      // Export still includes feedback even when browser storage is blocked.
    }
  }, [snapshot.feedback]);

  const visibleEvents = useMemo(() => {
    const filtered = snapshot.events.filter((event) => {
      const matchesSeverity =
        severityFilter === 'all' || event.severity === severityFilter;
      const text =
        `${event.kind} ${event.stage} ${JSON.stringify(event.data)}`.toLowerCase();
      return matchesSeverity && text.includes(eventFilter.toLowerCase());
    });
    return latestFirst ? [...filtered].reverse() : filtered;
  }, [eventFilter, latestFirst, severityFilter, snapshot.events]);

  const updateDraft = <K extends keyof LabRecipe>(
    key: K,
    value: LabRecipe[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const resetWithDraft = () =>
    runner.reset({
      ...draft,
      candidateBatches: Math.max(
        1,
        Math.min(8, Math.trunc(draft.candidateBatches)),
      ),
      maxSuggestions: Math.max(
        1,
        Math.min(64, Math.trunc(draft.maxSuggestions)),
      ),
      nodeBudget: Math.max(1, Math.trunc(draft.nodeBudget)),
    });

  const download = () => {
    const report = runner.exportReport({
      includeRawDebug: draft.includeRawDebug,
    });
    const blob = new Blob([json(report)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `generator-lab-${report.runId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const fillAssignments =
    snapshot.fill?.result.status === 'solved'
      ? snapshot.fill.result.solution?.assignments
      : undefined;
  const selectedAssignment = fillAssignments?.[selectedSlot];
  const selectedDecision = snapshot.candidateDecisions.find(
    (decision) =>
      decision.normalizedAnswer ===
      selectedAssignment?.word.trim().toUpperCase(),
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Crossword construction / development lab</p>
          <h1>Luna generation lab</h1>
          <p className="lede">
            A traceable six-stage harness for trying candidate-generation models
            against one real CSP fill.
          </p>
        </div>
        <div className="truth-badges" aria-label="Run truth labels">
          <span className="badge badge-fixture">Fixture / simulated model</span>
          <span className="badge">Experimental mini fill</span>
          <span className="badge badge-muted">Never publishable</span>
        </div>
      </header>

      <div className="notice" role="note">
        <strong>What is real:</strong> the deterministic CSP engine, worker
        path, stage trace, and exported evidence.{' '}
        <strong>What is simulated:</strong> Fixture mode's model suggestions and
        clue drafts. <strong>What is missing:</strong> a licensed lexicon,
        grounded clue validation, and editorial approval.
      </div>

      <main className="lab-layout">
        <aside className="panel recipe-panel" aria-label="Recipe and controls">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Recipe</p>
              <h2>Run controls</h2>
            </div>
            <span className={`model-state state-${snapshot.modelState}`}>
              {snapshot.modelState}
            </span>
          </div>
          <label>
            Model mode
            <select
              value={draft.mode}
              onChange={(event) =>
                updateDraft('mode', event.target.value as LabRecipe['mode'])
              }
            >
              <option value="fixture">Fixture (no download)</option>
              <option value="local-model">Local model (explicit setup)</option>
            </select>
          </label>
          {draft.mode === 'local-model' && (
            <label>
              Local model profile
              <select
                value={draft.modelProfile}
                onChange={(event) =>
                  updateDraft(
                    'modelProfile',
                    event.target.value as LabRecipe['modelProfile'],
                  )
                }
              >
                {LOCAL_MODEL_PROFILES.map((profile) => (
                  <option value={profile.id} key={profile.id}>
                    {profile.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Seed
            <input
              value={draft.seed}
              onChange={(event) => updateDraft('seed', event.target.value)}
            />
          </label>
          <label>
            Audience summary
            <input
              value={draft.audienceSummary}
              onChange={(event) =>
                updateDraft('audienceSummary', event.target.value)
              }
            />
          </label>
          <label>
            Focus
            <input
              value={draft.focus}
              onChange={(event) => updateDraft('focus', event.target.value)}
            />
          </label>
          <details className="advanced" open>
            <summary>Advanced recipe</summary>
            <label>
              Candidate batches{' '}
              <input
                type="number"
                min="1"
                max="8"
                value={draft.candidateBatches}
                onChange={(event) =>
                  updateDraft('candidateBatches', Number(event.target.value))
                }
              />
            </label>
            <label>
              Max suggestions{' '}
              <input
                type="number"
                min="1"
                max="64"
                value={draft.maxSuggestions}
                onChange={(event) =>
                  updateDraft('maxSuggestions', Number(event.target.value))
                }
              />
            </label>
            <label>
              Node budget{' '}
              <input
                type="number"
                min="1"
                value={draft.nodeBudget}
                onChange={(event) =>
                  updateDraft('nodeBudget', Number(event.target.value))
                }
              />
            </label>
            <label>
              Quality threshold{' '}
              <input
                type="number"
                step="0.01"
                value={draft.qualityThreshold}
                onChange={(event) =>
                  updateDraft('qualityThreshold', Number(event.target.value))
                }
              />
            </label>
            <label>
              Owner-supplied candidates{' '}
              <textarea
                rows={3}
                placeholder="One answer per line"
                value={draft.manualCandidates}
                onChange={(event) =>
                  updateDraft('manualCandidates', event.target.value)
                }
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.verboseTrace}
                onChange={(event) =>
                  updateDraft('verboseTrace', event.target.checked)
                }
              />{' '}
              Verbose trace (capped)
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.includeRawDebug}
                onChange={(event) =>
                  updateDraft('includeRawDebug', event.target.checked)
                }
              />{' '}
              Include local-only raw debug fields
            </label>
          </details>
          <div className="button-stack">
            <button
              className="button button-primary"
              disabled={busy || Boolean(snapshot.currentStage)}
              onClick={() => void run(() => runner.runAll())}
            >
              Run all
            </button>
            <button
              className="button"
              disabled={busy || Boolean(snapshot.currentStage)}
              onClick={() =>
                void run(async () => {
                  await runner.runNext();
                })
              }
            >
              Run next
            </button>
            <button
              className="button button-danger"
              disabled={!snapshot.currentStage}
              onClick={() => runner.cancel()}
            >
              Cancel active stage
            </button>
            <button
              className="button"
              disabled={busy || Boolean(snapshot.currentStage)}
              onClick={resetWithDraft}
            >
              Apply recipe / reset
            </button>
          </div>
          <p className="microcopy">
            Changing recipe fields only changes the next run. Apply recipe /
            reset preserves the current run as historical evidence.
          </p>
          {snapshot.environment && (
            <div className="environment-card">
              <strong>Environment</strong>
              <span>{snapshot.environment.manifest.id}</span>
              <span>
                {snapshot.environment.source === 'fixture'
                  ? 'Synthetic runtime'
                  : snapshot.environment.runtime?.webgpu
                    ? 'WebGPU detected'
                    : 'WebGPU unavailable'}
              </span>
              {snapshot.environment.runtime?.memorySource && (
                <span>{snapshot.environment.runtime.memorySource}</span>
              )}
            </div>
          )}
        </aside>

        <section
          className="panel pipeline-panel"
          aria-label="Pipeline and grid"
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Pipeline</p>
              <h2>Evidence from this run</h2>
            </div>
            <span className="run-id" title={snapshot.runId}>
              Run {snapshot.runId.slice(0, 8)}
            </span>
          </div>
          <ol className="stage-list">
            {STAGE_IDS.map((stageId, index) => {
              const stage = snapshot.stages[stageId];
              const blocked =
                index > 0 &&
                STAGE_IDS.slice(0, index).some(
                  (id) => snapshot.stages[id].status !== 'passed',
                );
              return (
                <li className={`stage-row stage-${stage.status}`} key={stageId}>
                  <button
                    className="stage-main"
                    aria-expanded={expanded === stageId}
                    onClick={() =>
                      setExpanded(expanded === stageId ? undefined : stageId)
                    }
                  >
                    <span className="stage-number">{index}</span>
                    <span className="stage-name">
                      <strong>{stage.label}</strong>
                      <small>
                        {stage.outputSummary ??
                          (blocked
                            ? 'Waiting for the previous stage'
                            : 'Ready')}
                      </small>
                    </span>
                    <span
                      className="stage-status"
                      aria-label={`Stage ${statusText(stage.status)}`}
                    >
                      {statusText(stage.status)}
                    </span>
                    <span className="chevron" aria-hidden="true">
                      {expanded === stageId ? '⌃' : '⌄'}
                    </span>
                  </button>
                  {expanded === stageId && (
                    <div className="stage-details">
                      <div className="stage-meta">
                        <span>
                          {stage.durationMs === undefined
                            ? 'Not run'
                            : `${Math.round(stage.durationMs)} ms`}
                        </span>
                        {stage.failure && (
                          <span className="error-text">
                            {stage.failure.code}: {stage.failure.message}
                          </span>
                        )}
                      </div>
                      <pre tabIndex={0}>
                        {json(
                          stage.details ?? {
                            input: stage.inputSummary ?? 'not recorded',
                          },
                        )}
                      </pre>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="grid-area">
            <div className="grid-heading">
              <div>
                <p className="eyebrow">Fixed template / 3×3</p>
                <h3>Crossing fill</h3>
              </div>
              <span className="score-chip">
                {snapshot.fill?.result.status === 'solved'
                  ? `score ${snapshot.fill.result.solution?.score.toFixed(2)}`
                  : 'geometry only'}
              </span>
            </div>
            <div
              className="crossword-grid"
              role="grid"
              aria-label="Three by three experimental crossword grid"
            >
              {Array.from({ length: 3 }, (_, row) =>
                Array.from({ length: 3 }, (_, column) => {
                  const projected = snapshot.grid?.[row]?.[column];
                  const acrossSlotId = `A${row + 1}`;
                  const downSlotId = `D${column + 1}`;
                  return (
                    <button
                      className={`grid-cell ${projected?.consistent === false ? 'grid-conflict' : ''}`}
                      role="gridcell"
                      key={`${row}-${column}`}
                      onClick={() => setSelectedSlot(acrossSlotId)}
                      title={`${acrossSlotId} / ${downSlotId}`}
                    >
                      <span className="cell-letter">
                        {projected?.letter ?? '·'}
                      </span>
                      <span className="cell-label">
                        {acrossSlotId} · {downSlotId}
                      </span>
                    </button>
                  );
                }),
              )}
            </div>
            <div
              className="slot-tabs"
              role="tablist"
              aria-label="Select a slot"
            >
              {MINI_TEMPLATE.slots.map((slot) => (
                <button
                  role="tab"
                  aria-selected={selectedSlot === slot.slotId}
                  className={selectedSlot === slot.slotId ? 'selected' : ''}
                  key={slot.slotId}
                  onClick={() => setSelectedSlot(slot.slotId)}
                >
                  {slot.slotId} {slot.direction}
                </button>
              ))}
            </div>
            <div className="selection-card">
              <strong>{selectedSlot}</strong>
              {selectedAssignment ? (
                <>
                  <span className="answer-large">
                    {selectedAssignment.word}
                  </span>
                  <span>
                    Source: {selectedDecision?.source ?? 'not recorded'}
                  </span>
                  <span>
                    Sense:{' '}
                    {selectedDecision?.suggestion.intendedSense ??
                      'not recorded'}
                  </span>
                </>
              ) : (
                <span>
                  This slot has no assignment yet. Its fixed length is 3 and
                  crossings are explicit in the template.
                </span>
              )}
            </div>
          </div>
          <div className="candidate-table-wrap">
            <h3>Candidate decisions</h3>
            <table>
              <caption className="sr-only">
                Accepted and rejected candidate suggestions
              </caption>
              <thead>
                <tr>
                  <th>Surface</th>
                  <th>Decision</th>
                  <th>Reason</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.candidateDecisions.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No resolution evidence yet.</td>
                  </tr>
                ) : (
                  snapshot.candidateDecisions.map((decision, index) => (
                    <tr key={`${decision.normalizedAnswer}-${index}`}>
                      <td>{decision.suggestion.surface}</td>
                      <td>
                        <span
                          className={
                            decision.accepted ? 'success-text' : 'warning-text'
                          }
                        >
                          {decision.accepted ? 'accepted' : 'rejected'}
                        </span>
                      </td>
                      <td>{decision.reason}</td>
                      <td>{decision.source}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {snapshot.clues.length > 0 && (
            <div className="candidate-table-wrap">
              <h3>Experimental clue drafts</h3>
              <table>
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>Answer</th>
                    <th>Source</th>
                    <th>Drafts</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.clues.map((clue) => (
                    <tr key={clue.slotId}>
                      <td>{clue.slotId}</td>
                      <td>{clue.answer}</td>
                      <td>{clue.source}</td>
                      <td>
                        {clue.drafts
                          .map((draftItem) => draftItem.text)
                          .join(' / ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="panel diagnostics-panel" aria-label="Diagnostics">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Diagnostics</p>
              <h2>Trace & export</h2>
            </div>
            <span className="event-count">
              {snapshot.events.length}
              {snapshot.droppedEventCount > 0
                ? ` (+${snapshot.droppedEventCount} dropped)`
                : ''}
            </span>
          </div>
          <div className="diagnostic-tabs" role="tablist">
            {(['summary', 'events', 'data'] as const).map((tab) => (
              <button
                role="tab"
                aria-selected={diagnosticTab === tab}
                className={diagnosticTab === tab ? 'selected' : ''}
                key={tab}
                onClick={() => setDiagnosticTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          {diagnosticTab === 'summary' && (
            <div className="diagnostic-summary">
              <p className="live-status" aria-live="polite">
                {snapshot.currentStage
                  ? `${snapshot.stages[snapshot.currentStage].label} is running`
                  : 'No stage is running'}
              </p>
              <dl>
                <div>
                  <dt>Mode</dt>
                  <dd>
                    {snapshot.recipe.mode === 'fixture'
                      ? 'Fixture / simulated model'
                      : 'Local model / browser worker'}
                  </dd>
                </div>
                <div>
                  <dt>Template</dt>
                  <dd>
                    {MINI_TEMPLATE.id} v{MINI_TEMPLATE.version}
                  </dd>
                </div>
                <div>
                  <dt>Accepted</dt>
                  <dd>{snapshot.acceptedCandidates.length}</dd>
                </div>
                <div>
                  <dt>Clue sets</dt>
                  <dd>{snapshot.clues.length}</dd>
                </div>
                <div>
                  <dt>Trace cap</dt>
                  <dd>2,000 events</dd>
                </div>
              </dl>
              <p className="caveat">
                The report intentionally omits prompts, raw model output,
                browser storage, telemetry, and personal data unless a future
                local-only debug field is explicitly added.
              </p>
            </div>
          )}
          {diagnosticTab === 'events' && (
            <div className="events-view">
              <div className="filter-row">
                <input
                  aria-label="Filter events"
                  placeholder="Filter events"
                  value={eventFilter}
                  onChange={(event) => setEventFilter(event.target.value)}
                />
                <select
                  aria-label="Severity"
                  value={severityFilter}
                  onChange={(event) => setSeverityFilter(event.target.value)}
                >
                  <option value="all">All severity</option>
                  <option value="info">Info</option>
                  <option value="success">Success</option>
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                </select>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={latestFirst}
                  onChange={(event) => setLatestFirst(event.target.checked)}
                />{' '}
                Latest first
              </label>
              <div className="event-list" tabIndex={0}>
                {visibleEvents.length === 0 ? (
                  <p>No matching events.</p>
                ) : (
                  visibleEvents.map((event) => (
                    <div
                      className={`event-row event-${event.severity}`}
                      key={event.sequence}
                    >
                      <div>
                        <span className="event-kind">{event.kind}</span>
                        <span className="event-stage">{event.stage}</span>
                      </div>
                      <time>{Math.round(event.timestampMs)} ms</time>
                      <pre>{json(event.data)}</pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          {diagnosticTab === 'data' && (
            <div className="data-view">
              <button className="button button-primary" onClick={download}>
                Export bounded JSON
              </button>
              <pre tabIndex={0}>
                {json(
                  runner.exportReport({
                    includeRawDebug: draft.includeRawDebug,
                  }),
                )}
              </pre>
            </div>
          )}
          <div className="feedback">
            <div className="feedback-heading">
              <h3>Feedback</h3>
              <span>saved locally</span>
            </div>
            <label>
              Run rating
              <select
                value={snapshot.feedback.rating}
                onChange={(event) =>
                  runner.setFeedback({
                    ...snapshot.feedback,
                    rating: event.target.value as LabFeedback['rating'],
                  })
                }
              >
                <option value="">Choose…</option>
                <option value="useful">Useful</option>
                <option value="mixed">Mixed</option>
                <option value="not-useful">Not useful</option>
              </select>
            </label>
            <label>
              Stage
              <select
                value={snapshot.feedback.stage}
                onChange={(event) =>
                  runner.setFeedback({
                    ...snapshot.feedback,
                    stage: event.target.value as LabFeedback['stage'],
                  })
                }
              >
                <option value="">Choose…</option>
                {STAGE_IDS.map((id) => (
                  <option value={id} key={id}>
                    {snapshot.stages[id].label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Observation
              <textarea
                rows={2}
                value={snapshot.feedback.observation}
                onChange={(event) =>
                  runner.setFeedback({
                    ...snapshot.feedback,
                    observation: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Expected behavior
              <textarea
                rows={2}
                value={snapshot.feedback.expectedBehavior}
                onChange={(event) =>
                  runner.setFeedback({
                    ...snapshot.feedback,
                    expectedBehavior: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Reproduction notes
              <textarea
                rows={2}
                value={snapshot.feedback.reproductionNotes}
                onChange={(event) =>
                  runner.setFeedback({
                    ...snapshot.feedback,
                    reproductionNotes: event.target.value,
                  })
                }
              />
            </label>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
