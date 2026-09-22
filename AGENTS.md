# Repository Agent Guide

## Overview

`crossword-generator` is the framework-independent generation core extracted
from the `crossword` application. It contains a deterministic crossword fill
engine, browser worker protocols and clients, and an in-browser local-model
runtime. The packages are designed to be consumed by a bundler; this repository
does not contain the product UI or a deployed service.

## Tech stack

- Node 24.x and npm 11.x, pinned by `.node-version` and `packageManager`.
- TypeScript 5.9 with strict checking, ES modules, and browser-compatible
  `DOM`/`ES2022` libraries.
- Vitest 3 for unit and contract tests.
- Stryker 10 for mutation testing of the deterministic construction engine.
- WebLLM is an optional runtime dependency exercised through adapters and fake
  model fixtures; tests never download model weights or require WebGPU.

## Startup protocol

Read `docs/REPO_MAP.md` immediately after this file. It is a bounded path and
symbol index, not a substitute for reading source. Regenerate it after adding,
removing, or renaming modules with:

```sh
bash .scripts/generate-repo-map.sh
bash .scripts/generate-repo-map.sh --check
```

Scope searches to the mapped package or use exact symbols. Do not recursively
index dependency, VCS, generated, report, or cache directories.

## Repository map

- `packages/construction/`: deterministic CSP fill engine and constructor
  worker protocol.
- `packages/model-runtime/`: local model broker, WebLLM adapter, fake adapter,
  and model worker protocol.
- `packages/generator/`: construction orchestration and browser worker clients.
- `docs/`: integration and agent-facing documentation.
- `.scripts/`: dependency-free repository-map tooling.

## Operational commands

Run these from the repository root. Prefer the Make targets so agents and CI
use the same commands.

| Task                    | Command              |
| ----------------------- | -------------------- |
| Clean-clone setup       | `make setup`         |
| Toolchain check         | `make doctor`        |
| Install Git hooks       | `make hooks-install` |
| Unit and contract tests | `make test`          |
| Coverage gate           | `make test-coverage` |
| Type checking           | `make typecheck`     |
| Lint                    | `make lint`          |
| Formatting check        | `make format-check`  |
| Repository-map update   | `make map-update`    |
| Repository-map check    | `make map-check`     |
| Mutation testing        | `make mutation-test` |
| Full local quality gate | `make check`         |

Use `make test` after changing tests or production TypeScript. Use
`make mutation-test` when changing `packages/construction/src/csp.ts` or its
tests. Keep model tests deterministic with the fake adapter; do not turn on
real model downloads as part of CI.

`make setup` installs the tracked `.githooks` path. The pre-commit hook
regenerates and stages `docs/REPO_MAP.md`; the pre-push hook checks that the
committed map is current.

## Change boundaries

- Preserve public package exports and worker message schemas unless the change
  explicitly includes a contract migration.
- Keep deterministic construction logic independent of WebLLM, React, Vue, and
  DOM-specific UI code.
- Validate untrusted worker/model messages at the protocol boundary.
- Prefer focused tests for failure codes, cancellation, resource limits,
  malformed model output, and worker lifecycle behavior.
- Do not manually edit `package-lock.json`; update it through npm after an
  intentional dependency change.
- Do not hand-edit `docs/REPO_MAP.md`; change the map generator and regenerate.

## Strict exclusions

Do not search, index, or manually modify `.git/`, `node_modules/`, `artifacts/`,
`coverage/`, `reports/`, `.stryker-tmp/`, or other generated/cache output.
Preserve unrelated working-tree changes.
