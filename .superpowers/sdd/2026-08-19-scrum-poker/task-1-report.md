# Task 1 Report: Workspace and Shared Protocol

## Summary

Implemented the pnpm workspace scaffold and the shared protocol package for Scrum Poker.

The protocol boundary now exports the domain contracts, validated request schemas, and compact wire encode/decode functions needed for SSE snapshots.

## Changed Files

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `vitest.workspace.ts`
- `packages/protocol/package.json`
- `packages/protocol/tsconfig.json`
- `packages/protocol/src/contracts.ts`
- `packages/protocol/src/schemas.ts`
- `packages/protocol/src/wire.ts`
- `packages/protocol/src/index.ts`
- `packages/protocol/test/wire.test.ts`
- `pnpm-lock.yaml`

## Commit

- `b7b8777` `feat: define scrum poker protocol`

## RED Evidence

The controller confirmed the required RED phase before implementation with:

`vitest run packages/protocol/test/wire.test.ts --configLoader runner --pool=threads --poolOptions.threads.singleThread`

Expected failure:

- `Cannot find module '../src/index.js'`

That matched the brief and proved the test was exercising the missing protocol entrypoint.

## GREEN Evidence

Focused protocol test:

`& '.\node_modules\.bin\vitest.cmd' run packages/protocol/test/wire.test.ts --configLoader runner --pool=threads --poolOptions.threads.singleThread`

Result:

- `2 passed`

Protocol typecheck:

`corepack pnpm --filter @scrum-poker/protocol typecheck`

Result:

- exit `0`

Protocol build:

`corepack pnpm --filter @scrum-poker/protocol build`

Result:

- exit `0`

## Implementation Notes

- `packages/protocol/src/contracts.ts` defines the shared room and wire types, including `VOTE_VALUES`, `VoteValue`, `RoomPhase`, `ParticipantView`, `RoomSnapshot`, `WireParticipant`, `WireSnapshot`, the three response interfaces, and the exact `ApiErrorCode` union.
- `packages/protocol/src/schemas.ts` exports trimmed display-name and vote schemas with 1 to 30 character enforcement and deck-value validation.
- `packages/protocol/src/wire.ts` encodes snapshots into compact wire keys and decodes them back, preserving hidden-vote secrecy during voting and rejecting unsupported versions, malformed tuples, and invalid revealed votes.
- `packages/protocol/src/index.ts` re-exports the shared protocol surface from one package entrypoint.

## Self-Review

- The revealed snapshot round-trip preserves the full room shape, including visible votes.
- The voting-phase wire format does not leak vote values.
- The deck is fixed to the exact required values and is validated through Zod.
- The package builds cleanly under strict NodeNext TypeScript settings.

## Concerns

- The repository still has local-only verification helpers and install artifacts outside the committed task files. They were intentionally left out of the Task 1 commit.
- Vitest on this Windows sandbox required the external execution context to complete the green verification path without the spawn failure seen during the initial local runs.

## Fix Round: Review Findings

### Summary

Addressed the review findings that flagged false-green repo scripts, an unusable workspace file, and missing codec rejection coverage.

The repository entry points are now honest:

- `lint:no-sockets` runs a real manifest scan.
- `test:e2e` and `test:load` fail explicitly as not yet implemented.
- `vitest.workspace.ts` now defines runnable repo and protocol projects.

The codec now has focused negative coverage for unsupported versions, malformed tuples, hidden-vote secrecy, and invalid revealed votes.

### RED Evidence

Focused regression suite before the fix:

`& '.\node_modules\.bin\vitest.cmd' run test/repo-contracts.test.ts test/no-sockets.test.ts packages/protocol/test/wire.test.ts --configLoader runner --pool=threads --poolOptions.threads.singleThread`

Observed failures included:

- `lint:no-sockets` still set to `node -e "process.exit(0)"`
- `test:e2e` still set to `node -e "process.exit(0)"`
- `test:load` still set to `node -e "process.exit(0)"`
- `Cannot find module '../scripts/no-sockets.mjs'`
- codec rejection branches returning the generic `Malformed wire snapshot`

### GREEN Evidence

Focused regression suite after the fix:

`& '.\node_modules\.bin\vitest.cmd' run test/repo-contracts.test.ts test/no-sockets.test.ts packages/protocol/test/wire.test.ts --configLoader runner --pool=threads --poolOptions.threads.singleThread`

Result:

- `3 passed`
- `11 passed`

Task 1 focused protocol command after the fix:

`& '.\node_modules\.bin\vitest.cmd' run packages/protocol/test/wire.test.ts --configLoader runner --pool=threads --poolOptions.threads.singleThread`

Result:

- `5 passed`

Protocol typecheck after the fix:

`corepack pnpm --filter @scrum-poker/protocol typecheck`

Result:

- exit `0`

Protocol build after the fix:

`corepack pnpm --filter @scrum-poker/protocol build`

Result:

- exit `0`

Repo guard check:

`corepack pnpm lint:no-sockets`

Result:

- exit `0`

### Changed Files in Fix Round

- `package.json`
- `vitest.workspace.ts`
- `vitest.config.mjs`
- `scripts/no-sockets.mjs`
- `scripts/not-implemented.mjs`
- `test/repo-contracts.test.ts`
- `test/no-sockets.test.ts`
- `packages/protocol/src/wire.ts`
- `packages/protocol/test/wire.test.ts`

### Self-Review

- The root scripts are no longer fake-green.
- The no-socket guard is real but intentionally narrow, which matches the current scope.
- The workspace file is populated and the regression tests prove it is discoverable.
- The codec rejection branches are covered without overbuilding the wire format.

### Concerns

- Vitest still emits a deprecation warning about workspace files on this version.
- The e2e and load scripts intentionally fail until their planned tasks land.

### Fix Commit

- `e3f99a7` `fix: make repo verification honest`

## Fix Round 2: Workspace Runtime Usability

### Summary

Fixed the remaining workspace/runtime regression by moving the protocol project behind a package-local Vitest config and restoring the workspace file to reference that config directly.

This keeps `zod` declared in `packages/protocol/package.json` and makes the direct workspace-focused Vitest command resolve the protocol package from its own project root during a clean reinstall.

### RED Evidence

Regression check before the fix:

`& '.\node_modules\.bin\vitest.cmd' run test/workspace-project.test.ts --configLoader runner --pool=threads --poolOptions.threads.singleThread`

Observed failure:

- expected `vitest.workspace.ts` to contain `packages/protocol/vitest.config.mjs`
- the file still pointed at the inline `packages/protocol` project

Clean reinstall before the green verification:

`corepack pnpm install --force`

Result:

- exit `0`

### GREEN Evidence

Direct workspace-focused command after the fix:

`& '.\node_modules\.bin\vitest.cmd' run --workspace vitest.workspace.ts packages/protocol/test/wire.test.ts --configLoader runner --pool=threads --poolOptions.threads.singleThread`

Result:

- `|protocol| test/wire.test.ts (5 tests)`
- `1 passed`
- `5 passed`

Protocol package test after the fix:

`corepack pnpm --filter @scrum-poker/protocol test`

Result:

- `|protocol| test/wire.test.ts (5 tests)`
- `1 passed`
- `5 passed`

Protocol typecheck after the fix:

`corepack pnpm --filter @scrum-poker/protocol typecheck`

Result:

- exit `0`

Protocol build after the fix:

`corepack pnpm --filter @scrum-poker/protocol build`

Result:

- exit `0`

Regression test after the fix:

`& '.\node_modules\.bin\vitest.cmd' run test/workspace-project.test.ts --configLoader runner --pool=threads --poolOptions.threads.singleThread`

Result:

- `1 passed`

### Changed Files in Fix Round 2

- `vitest.workspace.ts`
- `packages/protocol/vitest.config.mjs`
- `.superpowers/sdd/2026-08-19-scrum-poker/task-1-report.md`

### Self-Review

- The workspace file now points at a real package config instead of an inline protocol project, which matches the working direct workspace invocation.
- `defineProject` is used in the package config, which is the Vitest-recommended shape for a project file.
- The protocol package still owns its `zod` dependency; the fix does not weaken or remove it.
- The focused workspace command, package test, typecheck, and build all pass after a clean reinstall.

### Concerns

- Vitest still emits the workspace deprecation warning on this version.
- The workspace-level entry point remains in place for the current plan, but Vitest will want `test.projects` in a later migration.

### Fix Commit

- _pending_
