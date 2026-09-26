# Full-size construction plan

## Target

The lab's normal workflow constructs a 15×15 American-style crossword, then lets the owner compare local language models on clue drafts. A complete grid is not automatically an edited, publishable puzzle.

## Implementation decisions

1. Use the MIT-licensed `xfill` Rust construction engine and its separately MIT-licensed Crossword Nexus scored word list, pinned as source under `vendor/xfill/`. This engine already handles symmetric grid generation, checked entries, ranked fill, and numbered JSON export. HiGHS is a strong linear/MIP solver, but crossword fill is naturally a word-domain constraint problem; the proven fill-specific engine is the smaller integration risk.
2. Expose the engine through a local Vite API. Build the Rust binary lazily with Cargo, run bounded jobs, validate every returned grid, and show provenance and scores. Ship one engine-generated 15×15 example so a static build has meaningful content even before a new run.
3. Use local Ollama models for optional clue comparison. List installed models dynamically, request drafts for a selected entry, retain drafts by model, and let the owner edit the final clue. The fill works with no model running.
4. Add tests for 15×15 geometry/entry/crossing validation, API input bounds, and a full engine generation smoke. Run the browser UI and repository gates.

## Verified implementation

- Bundled example: 15×15, 74 entries, 38 blocks, mean score 84.97, minimum score 70, zero entries below 50.
- Fresh themeless generation: local Vite API, 15×15 output with 74 entries and zero entries below 50 in a seed-21 run.
- Themed generation: `HOMERUN`, `HATTRICK`, and `SLAMDUNK` produced a 76-entry 15×15 grid with zero entries below 50 under the entry cap.
- Ollama `qwen3.8:27b` returned a usable clue draft for `SESAMESEED`; `qwen3:0.6b` produced malformed/repetitive output and is not selected by default.
- Model-assisted theme ideas populate editable theme answers; the owner reviews them before construction. Draft/final clue edits and the current grid persist in browser storage, and JSON export remains available.
- A minimum per-entry score is enforced while loading the word list. A seed-31 search with floor 70 produced a clean 15×15 grid from 250 candidate shapes; a floor of 65 found no qualifying grid in one 100-candidate seed-1 run. Generation cancellation was verified through the local API.
- `make check`, 13 lab tests, 53 Rust engine tests, and the mutation suite pass; `npm audit` reports zero vulnerabilities after updating the test-runner dependencies.

## Next development slices

- Grid editing and locked-entry repair/regeneration for problematic fills.
- Bulk clue drafting, answer/sense grounding, clue verification, and editorial QA before any publication claim.
- Import/export to standard puzzle formats and a grid/entry editor with repair workflows.
- Provider adapters for other local or remote models using the same draft comparison record, with explicit key handling and cost controls.

## Provenance

Engine source: `ekorbia/xword-pipeline` at commit `7170d41a3f3a331247f6193243061905dce17a94` (MIT). Scored data: Crossword Nexus Collaborative Word List (MIT), with its license in `vendor/xfill/data/LICENSE-wordlist.txt`. Keep both notices with any redistribution.
