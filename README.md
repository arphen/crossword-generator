# Crossword generator

Framework-independent, in-browser crossword construction, extracted from `crossword` commit `9c964ab917b1ba42915cd034b53d2718179ebb0d`. This is a separate development repository, not a separate deployed service. The original history remains in the crossword repository; the initial commit here is an extraction snapshot.

## Packages

- `@crossword/construction`: deterministic fill engine, cancellation/progress, worker protocol.
- `@crossword/model-runtime`: model broker, WebLLM adapter and engine worker, deterministic fake adapter, protocol.
- `@crossword/generator`: construction use cases, browser worker clients and entry points. No React or Vue dependencies.

## Develop

Use Node 24 and npm 11 (the consuming app's toolchain).

```sh
make setup
make doctor
make test
make typecheck
make check
npm run pack:packages
# Optional, potentially expensive:
make mutation-test
```

Tests use synthetic fixtures and fake model adapters; they do not download weights or establish real WebGPU generation quality. Extraction exposed missing DOM library declarations and two pre-existing test type errors, corrected without changing generation algorithms.

`make check` is the local quality gate. It runs TypeScript checks, ESLint,
Prettier, the generated repository-map check, and the coverage suite. Changes
to the deterministic fill engine must also pass `make mutation-test`; the
initial mutation floor is 55%.

`make setup` installs the tracked Git hooks. The pre-commit hook regenerates
and stages `docs/REPO_MAP.md`; the pre-push hook verifies that the committed map
is current.

Agent-facing repository conventions are in [AGENTS.md](AGENTS.md), and the
bounded navigation index is [docs/REPO_MAP.md](docs/REPO_MAP.md).

## Integrate into the browser app

Copy the three `artifacts/*.tgz` archives into the crossword repo's `vendor/generator/`. That repo uses locked `file:` dependencies so a clean frontend checkout does not need this sibling directory. Update the package versions, file dependency paths and frontend lockfile for subsequent releases; do not silently overwrite released archive versions.

Exports are TypeScript source for a TypeScript-aware bundler such as Vite, preserving the previous workspace contract. The model adapter starts a nested WebLLM worker, requiring Vite `worker.format: 'es'`. The frontend can keep tiny worker-entry shims importing `@crossword/generator/model-worker` and `@crossword/generator/constructor-worker`. Browser client APIs are exported from `/model-client` and `/constructor-client`; construction orchestration is exported from the package root.

Both Vue and React can use the same packages through a bundling integration. This extraction does not implement direct script-tag Vue loading or a complete model-to-playable-puzzle pipeline beyond the functionality already present. Product-specific model selection, UI controls, puzzle presentation and persistence remain in the crossword app.

No remote repository has been created or published.
