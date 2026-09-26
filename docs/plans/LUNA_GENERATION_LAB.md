# Luna execution plan: generator lab UI

Status: ready for implementation. Repository: `crossword-generator`.

## Goal

Build a small browser UI where the owner can run the current generator in
steps, see what each step received and produced, inspect failures, and send
specific feedback from an actual run. This is a development lab for a mini
crossword, not the public solving app. A successful fake run must produce a
real fill from the existing CSP engine. A real local-model run must use the
existing WebLLM worker path and report honestly if the current lexicon or
model cannot produce a fill.

The first useful session should take one command and no model download:
`npm run lab:dev`, open the local URL, choose **Fixture**, click **Run all**,
then inspect the grid, stage details, and trace. The owner can switch to
**Local model** deliberately to evaluate actual model output.

## Read before editing

1. Read `AGENTS.md`, `docs/REPO_MAP.md`, and `README.md` in this repository.
2. Inspect the APIs and tests in `packages/construction/src/csp.ts`,
   `packages/model-runtime/src/{broker,fakeAdapter,webllmAdapter}.ts`, and
   `packages/generator/src/constructionUseCases.ts` and `src/workers/`.
3. Preserve the package and worker contracts; extend them additively where
   observability requires it. Keep the UI under a new `apps/lab/` workspace.
4. Regenerate the repository map after adding files. Do not change the
   `crossword` sibling repository as part of this task.

## What exists today, and what must be labeled accurately

| Part               | Current implementation                                                                                                        | Lab responsibility                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Model lifecycle    | `createModelBroker` and `ModelWorkerClient` support configure/install/load/generate/compose/unload                            | Show capability, state, operation result, elapsed time, and actual load progress when available.                                   |
| Candidate batches  | `generateCandidateBatches` applies bounded batch count, derived seeds, and evolving exclusions                                | Show each batch separately, including request, suggestions, duplicates, and failures. Share this logic with the existing use case. |
| Lexicon resolution | `LexiconResolver` is an interface; no approved lexicon artifact is shipped here                                               | Supply a tiny clearly marked synthetic fixture for the lab. Show accept/reject reason and provenance for every suggestion.         |
| Topology           | `FillRequest` accepts slots and intersections; there is no topology generator or cell-coordinate model here                   | Supply one explicit, tested 3×3 crossing template with slot-to-cell coordinates. Label it a fixed template.                        |
| Fill               | `solveFillAsync` and `ConstructorWorkerClient` return solution/failure and progress `{nodes, assigned, openSlots, bestScore}` | Render progress and the actual assignment in the template grid; show limits and failure codes.                                     |
| Clues              | `composeClues` returns drafts; no grounded final-clue validator or puzzle publisher is implemented here                       | Show drafts as **experimental**, with their inputs and source. Do not label the result publishable.                                |

The fixture mode simulates the model through `createFakeLocalModelAdapter`.
Always badge its run **Fixture / simulated model**. The local-model mode must
never silently substitute fixture candidates after a model failure. Every
answer in a report needs a source label: fixture, model suggestion, or owner
supplied. The current solution is an experimental mini fill, not a validated
daily puzzle.

## Interaction contract

The page has three compact regions (stack them at narrow widths):

```text
Recipe & controls     Pipeline / 3×3 grid           Diagnostics
mode, seed, limits    0 Setup  1 Candidates          Summary | Events | Data
Run next / Run all    2 Resolve  3 Fill             filter, inspect, export
Cancel / Reset        4 Clue drafts  5 Review         feedback notes
```

- A stage has `idle`, `running`, `passed`, `failed`, or `cancelled` status,
  start/end time, duration, input summary, output summary, and expandable
  structured details. A failed prerequisite blocks later stages visibly.
- **Run next** executes exactly one ready stage. **Run all** stops at the
  first failure. **Cancel** aborts the active model or fill job and records
  the actual cancellation outcome. **Reset** starts a new run. Do not claim
  pause/resume within an in-flight CSP search; restart from a stage boundary.
- Editing seed, template, candidates, batch count, node budget, or quality
  threshold invalidates that stage and every downstream result. Earlier
  evidence remains viewable until the next run, clearly marked historical.
- The recipe exposes mode, seed, audience/focus, requested roles, candidate
  batches (1–8), max suggestions (1–64), node budget, and quality threshold.
  Advanced inputs can be collapsed; defaults must run the fixture successfully.
- The grid shows fixed cells, slot IDs, crossings, assigned words, and a
  selected slot's candidate and clue details. Before fill it shows template
  geometry; after failure it keeps the last valid evidence instead of showing
  a false completed puzzle.
- Diagnostics offer severity/stage filters, text search, latest-first toggle,
  compact event rows, structured JSON inspection, and a bounded export.
  Include a small **Feedback** area: run rating, stage, observation, expected
  behavior, and reproduction notes. Save locally and include it in export.
- Accessibility: buttons have visible names and disabled reasons, stage
  status is text as well as color, progress has a live region with throttled
  announcements, tables and JSON panes are keyboard reachable, and the layout
  works at 200% zoom.

## Pipeline to implement

| Stage          | Input and action                                                                                                                                                                 | Evidence shown                                                                                                                                       | Stop condition                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 0. Prepare     | Select fixture or local model; validate recipe, fixed template, and capability. In local mode configure, install, and load the pinned dev model only after explicit user action. | Browser/WebGPU/storage probe with source or `unknown`, manifest ID/version, broker state changes, setup duration, download/load progress if emitted. | Invalid recipe, unsupported device, quota, or model lifecycle failure.    |
| 1. Generate    | Run each candidate batch using the same seed suffix and exclusions as `generateCandidateBatches`.                                                                                | Per-batch request, count, surfaces, roles, confidence, elapsed time, duplicate/excluded count, bounded raw output when opted in.                     | Model failure, cancellation, or invalid output.                           |
| 2. Resolve     | Match suggestions against the lab fixture lexicon and score metadata; keep a decision for every suggestion.                                                                      | Accepted/rejected table with exact reason, normalized answer, lexeme/source ID, and candidate score; count by reason.                                | No accepted candidates.                                                   |
| 3. Fill        | Send the `FillRequest` to `ConstructorWorkerClient`; use the selected template and limits.                                                                                       | Slot/intersection count, progress nodes/assigned/open slots/best score, result score, assignments, failure code and message.                         | Failed or cancelled fill.                                                 |
| 4. Draft clues | For each assigned answer, call the model's `composeClues` using the fixture sense or resolved intended sense.                                                                    | Request, drafts, mechanism, difficulty, elapsed time, and missing/failed clue count.                                                                 | Model failure or cancellation; retain the valid fill as a partial result. |
| 5. Review      | Assemble a lab report and render the grid/entry list.                                                                                                                            | Run ID, mode, seed, template/version, input hashes, stage timing, source labels, score, incomplete gates, feedback.                                  | Never mark it published or editorially approved.                          |

Use a single 3×3 fixture whose six Across/Down answers are distinct and
whose crossings are verified by tests. It should include at least one
rejected suggestion and one decoy candidate so the resolution and search
steps are informative. Store explicit `{slotId, row, column, direction,
length}` geometry next to the `FillRequest`; do not infer geometry from the
solver's slot IDs. Keep fixture words and clue text original/synthetic and
document their provenance in the fixture module. If a local-model suggestion
is not in the fixture lexicon, show that rejection; do not fabricate a match.
Allow owner-supplied ephemeral candidates for experiments, label them as
manual, and never count them as model-origin evidence.

A concrete starting fixture is the Across rows `CAT / ORE / PEN`, producing
Down columns `COP / ARE / TEN`. Those are six distinct candidates with nine
crossings. Add asymmetric prefilled patterns or scores to make the expected
orientation deterministic while leaving at least one real search choice.
Include a plausible decoy and a suggestion rejected by the fixture lexicon;
assert that the displayed cells agree with all six assignments.

## Debug data contract

Define a small typed `LabEvent` in `apps/lab/` with `schemaVersion`, `runId`,
monotonic timestamp, `stage`, `kind`, `severity`, optional worker request/job
ID, and bounded serializable `data`. Record both stage transitions and
substantive decisions: recipe validation, model state/progress, each batch,
normalization/resolution, fill progress summaries, assignment, clue draft,
cancellation, and errors. Preserve the original typed failure code.

Keep a bounded in-memory ring (for example 2,000 events); show dropped count.
Throttle visible CSP progress to about 5–10 updates/second while preserving
final counters and any changed best score. Never invent a percentage for model
generation or CSP search when the API supplies no denominator. Offer a
separate **verbose trace** toggle for per-node/per-candidate detail, with a
cap, so the browser stays responsive.

The export is a versioned JSON file containing recipe, stage results,
candidate decisions, fill and draft outcomes, event log, environment summary,
and owner feedback. No telemetry or server upload. Default export omits model
prompts, raw model response text, browser storage contents, and unrelated
personal data; a clearly labeled local-only switch may include bounded raw
prompt/response text for debugging. Report when a field was unavailable rather
than replacing it with a guessed value.

For real model setup progress, use WebLLM's existing engine initialization
callback: it is currently accepted by the adapter's engine factory but
discarded by `install`/`load`. Thread an optional, validated progress event
through the adapter, broker/worker, and client without breaking existing
callers. The model worker currently posts state after operations, so record an
operation-start event as well. If the runtime offers no progress for a phase,
show an indeterminate state and elapsed time.

## Implementation slices for Luna

Complete these in order. Each slice should leave the lab runnable or its
fixtures testable; do not stop after the scaffold.

1. **Workspace and fixture.** Add `apps/lab/` as a private Vite + React +
   TypeScript workspace, with `lab:dev`, `lab:build`, and `lab:test` scripts
   at the root. Add the fixed topology, synthetic lexicon, fake model data,
   and a pure projection from `FillSolution` to 3×3 cells. Add tests for
   crossings, distinct answers, failure to place conflicting assignments,
   and provenance labels. Keep the app out of the three npm package archives.
2. **Runner and trace.** Build a lab-only state machine behind a `LabRunner`
   interface. Use the existing packages and browser constructor worker.
   Extract a shared batch observer/helper in `packages/generator` if needed
   so the lab and `constructOriginalFill` cannot diverge on seed/exclusion
   behavior. Forward fill progress; record accept/reject reasons at the lab
   resolver. Test stage order, dependent invalidation, failure short circuit,
   cancellation, deterministic replay, and event caps.
3. **UI.** Implement the three regions and controls above. Default to the
   fixture. The first screen must say what is real, simulated, and missing.
   Make stage rows expandable; show grid, candidate decisions, detailed
   events, and export/feedback. Keep styling functional and quiet. Test the
   important interactions with Vitest and a browser smoke run.
4. **Local model path.** Wire `ModelWorkerClient` to an explicit development
   manifest and a browser capability probe. Choose a supported small WebLLM
   development model after checking the installed runtime catalog; pin and
   document the choice. Add setup progress events, honest unsupported/quota
   states, cancellation, and worker error display. Never start a download on
   page load. Test protocol/client events with fakes; perform a manual
   supported-device run when available and record the device/runtime result.
5. **Evidence and handoff.** Add a concise README section with the exact
   local command, fixture vs local-model behavior, known gaps, and export
   instructions. Regenerate `docs/REPO_MAP.md`. Record one successful fixture
   run, one intentional rejection/failure run, one cancellation run, and a
   local-model run or an explicit hardware limitation. Include screenshots
   and an example sanitized report in `docs/` if useful for owner review.

Run `make check`, `npm run lab:build`, and the lab interaction tests. Run
`make mutation-test` if the CSP algorithm or its tests change. Do not weaken
coverage or mutation thresholds to accommodate the UI. Update the lockfile
through npm for new dependencies. Keep generated bundles/reports ignored.

## Acceptance for the owner's first feedback session

- `npm run lab:dev` opens a working lab with no backend and no model download.
- In Fixture mode, **Run next** visibly advances every stage; **Run all**
  reaches a real solved 3×3 CSP fill and experimental clue drafts.
- The owner can change the seed or node budget, rerun, inspect before/after
  evidence, cancel an active job, and see a truthful typed failure.
- A real-model attempt uses only the browser worker path and displays its
  model ID, lifecycle, generated candidates, and exact stop point. Lack of
  WebGPU or an accepted candidate set is reported as a result, not hidden.
- Exported JSON reproduces the recipe and includes the owner's notes. Running
  the same fixture recipe twice yields the same candidate decisions, fill,
  and clues; only IDs and timings may differ.
- All repository gates pass. Luna's report gives the command run, test
  results, observed browser behavior, screenshots or their paths, and the
  remaining gaps before a publishable crossword pipeline.

The owner's feedback questions after trying it are: Which stage feels opaque?
Which rejection or failure needs a better explanation? Is the model output
useful for the fixed mini topology? Which controls or diagnostics should move
into the next development slice? Use those answers and the exported run report
to prioritize subsequent generator work.
