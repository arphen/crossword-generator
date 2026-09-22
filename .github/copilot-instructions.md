# GitHub Copilot Custom Instructions

## Project context

This is a framework-independent TypeScript library for crossword construction
and browser-local model assistance. It is split into three npm workspaces:

- `@crossword/construction` owns deterministic CSP solving and worker protocol
  validation.
- `@crossword/model-runtime` owns the model broker, WebLLM adapter, fake model
  adapter, and model protocol validation.
- `@crossword/generator` owns construction use cases and browser worker clients.

The consuming application supplies UI, persistence, and bundler worker entry
points. Do not add React, Vue, Flask, or network-dependent test fixtures here.

## Working rules

- Use Node 24/npm 11 and the pinned lockfile.
- Prefer `make` targets for setup, type checking, linting, formatting, and
  tests.
- Keep public exports and worker message contracts backward-compatible unless a
  migration is part of the task.
- Validate unknown data at worker and model boundaries; keep failure codes
  explicit and deterministic.
- Use fake model adapters and synthetic crossword fixtures in tests. Never make
  CI depend on model downloads, WebGPU, or a private provider.
- Regenerate `docs/REPO_MAP.md` with `.scripts/generate-repo-map.sh` when the
  repository shape changes.

## Implementation checklist

1. Update the smallest owning package.
2. Add or update a focused Vitest contract test.
3. Run `make check`.
4. Run `make mutation-test` for deterministic construction changes.
