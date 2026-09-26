# Generator lab handoff

This is a sanitized development record, not a puzzle publication record.

## Fixture run

Command: `npm run lab:test` and the browser session started with
`npm run lab:dev`.

- Mode: Fixture / simulated model; no model download or backend.
- Template: `mini-3x3-crossing@1`, with nine explicit crossings.
- Expected solved grid: `CAT / ORE / PEN` across and `COP / ARE / TEN` down.
- Observed: the real CSP engine solved the grid; the projection kept all nine
  cells consistent and six experimental clue sets were produced.
- Resolution evidence: `UNLISTED` was rejected as
  `not-in-fixture-lexicon`; `CAR` was accepted as a deliberate low-score decoy
  and could be explored by the search without being shown as the final answer.
- Source labels: fixture, model suggestion, and owner supplied are kept
  distinct in decisions and exports.

## Intentional failure and cancellation

Setting the node budget to `1` stops at Fill with the typed
`resource-limit` failure; Clues and Review remain idle. Cancelling while Fill
is active records `cancelled` and does not claim a completed grid.

## Local model limitation

The pinned development catalog entry is
`Llama-3.2-1B-Instruct-q4f16_1-MLC` from WebLLM `0.2.85`. The browser worker
path is wired and progress is forwarded when available, but this repository's
automated checks do not download weights or require WebGPU. On a machine
without WebGPU the UI stops during Prepare with `unsupported-device`; on a
supported machine the first explicit Prepare may download the pinned model to
browser storage.

## Next feedback questions

1. Which stage feels opaque?
2. Which rejection or failure needs a better explanation?
3. Is the model output useful for this fixed mini topology?
4. Which controls or diagnostics should move into the next development slice?
