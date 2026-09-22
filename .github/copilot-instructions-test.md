# GitHub Copilot Test Instructions

These instructions apply to tests and test-support changes.

## Test commands

- Use Vitest; do not introduce Jest or a second test runner.
- Run `make test` after changing tests or production code.
- Run `make test-coverage` when coverage behavior or thresholds are involved.
- Run `make mutation-test` for changes to `packages/construction/src/csp.ts` or
  its tests.

## Test design

- Keep tests deterministic and offline.
- Prefer `describe`/`it` with Arrange/Act/Assert structure.
- Cover both successful results and typed failures.
- Exercise malformed protocol messages, cancellation, resource limits, model
  lifecycle transitions, and worker request correlation where relevant.
- Use `createFakeLocalModelAdapter` instead of real model weights or WebGPU.
- Keep package tests beside their source as `*.test.ts` files.

## Test categories

- Unit tests isolate the CSP engine, broker, adapters, and pure helpers.
- Contract tests verify worker request/response parsing and client behavior.
- Integration-style tests may compose package APIs and fake adapters, but must
  not call the network or require browser hardware.
