# Task 9 Report

Date: Thursday, August 20, 2026

## Round 1 fixes

- `openStreams` now registers each created stream in the caller-owned collection immediately.
- Opening and initial-snapshot setup use settled cleanup paths; setup errors and snapshot timeouts abort/close every partial stream before rejection.
- `LoadResult` carries `allowedUnexpectedDisconnects`, and evaluation passes counts through the inclusive configured allowance. The default remains `0`; explicit zero is accepted.
- `load/README.md` documents the allowance behavior.

No production or remote load was run.

## Scope

Implemented the Task 9 shared-VM SSE capacity gate work in the shared checkout:

- added the SSE load runner in `load/sse-load.ts`;
- added load contract tests in `load/sse-load.test.ts`;
- added load-specific Vitest and TypeScript configs in `load/vitest.config.mjs` and `load/tsconfig.json`;
- added `load/README.md`;
- added `load/package.json` for the generated CommonJS CLI boundary;
- replaced the root `test:load` placeholder in `package.json`;
- added `apps/server start:test` in `apps/server/package.json`;
- extended the repository-local binary wrapper to resolve the TypeScript and cross-env Windows shims used by the load command.

No production load was run.

## Focused RED/GREEN evidence

### RED 1

Command:

```text
node scripts/run-local-bin.mjs vitest run --config load/vitest.config.mjs load/sse-load.test.ts
```

Result:

```text
FAIL load/sse-load.test.ts
Error: Cannot find module './sse-load.ts'
```

### GREEN 1

Command:

```text
node scripts/run-local-bin.mjs vitest run --config load/vitest.config.mjs load/sse-load.test.ts
```

Result:

```text
✓ load/sse-load.test.ts (8 tests)
```

### RED 2

Command:

```text
node scripts/run-local-bin.mjs vitest run --config load/vitest.config.mjs load/sse-load.test.ts
```

Result:

```text
× runLoadCheck > exercises the public HTTP and SSE API for the required 100-client load shape
  → (0 , runLoadCheck) is not a function
```

### GREEN 2

Fresh final focused command:

```text
node scripts/run-local-bin.mjs vitest run --config load/vitest.config.mjs load/sse-load.test.ts
```

Result:

```text
✓ load/sse-load.test.ts (10 tests) 1689ms
✓ runLoadCheck > exercises the public HTTP and SSE API for the required 100-client load shape 1680ms
```

### Round 1 RED/GREEN

The cleanup regression reached two streams, then failed because the implementation observed `abortedStreamCount` as `0`; the allowance tests failed because evaluation still expected zero. The focused run reported `14 tests | 4 failed`.

The explicit-zero parser regression then failed with:

```text
--allowed-unexpected-disconnects must be a positive integer.
```

The focused run reported `15 tests | 1 failed`.

After the fixes, the same focused command passed:

```text
✓ load/sse-load.test.ts (15 tests) 1721ms
Test Files  1 passed (1)
Tests  15 passed (15)
```

The suite includes the real local server contract for 5 rooms × 20 participants, representative vote/reveal/reset actions, aggregate-only log assertions, allowance boundary tests, and the partial-SSE cleanup regression.

## Verification

### No-socket guard

Command:

```text
node scripts/no-sockets.mjs
```

Result:

```text
No forbidden socket transports found.
```

### Typecheck

Command:

```text
corepack pnpm typecheck
```

Result:

```text
packages/protocol typecheck: Done
apps/server typecheck: Done
apps/web typecheck: Done
```

### Build

Command:

```text
corepack pnpm build
```

Result:

```text
packages/protocol build: Done
apps/server build: Done
apps/web build: Done
```

Observed warning during build:

```text
Unsupported engine: wanted: {"node":">=20 <21"} (current: {"node":"v24.19.0","pnpm":"11.19.0"})
```

### Full tests

Command:

```text
corepack pnpm test
```

Result:

```text
Test Files 22 passed (22)
Tests 99 passed (99)
```

Additional workspace package test runs completed inside the root script:

```text
@scrum-poker/protocol: 1 file passed, 5 tests passed
@scrum-poker/server: 7 files passed, 41 tests passed
@scrum-poker/web: 10 files passed, 42 tests passed
```

Standalone load runner typecheck also passed:

```text
node scripts/run-local-bin.mjs tsc -p load/tsconfig.json --noEmit
```

## Local 30-second load check

Attempted smoke command:

```text
node scripts/run-local-bin.mjs start-server-and-test "corepack pnpm --filter @scrum-poker/server start:test" http://127.0.0.1:4100/health/ready "corepack pnpm test:load -- --base-url=http://127.0.0.1:4100 --duration-seconds=30"
```

Result:

```text
Completed SSE load check: clients=100, initialSnapshots=100, rooms=5/5, disconnects=0, bytes=479100, durationMs=30476.
clients=100/100, initialSnapshots=100, completedRooms=5/5, unexpectedDisconnects=0, receivedBytes=479100, durationMs=30476
```

The local server returned HTTP `200` from `/health/ready`, and the runner shut down cleanly after the smoke check.

## Cleanup performed

After the local smoke, confirmed the test server was isolated to `127.0.0.1:4100` and cleaned up. No production or remote load action was performed.

## Limitations

1. The production five-minute PM2/RSS observation was not run; it requires explicit production approval and remains documentation-only.

## Commits

- Implementation: `abb9578` (`test: add shared VM SSE capacity gate`)
- Review fix: `3c77ae5` (`fix: harden Task 9 stream cleanup`)
- Report correction: `ac6a36b` (`docs: record Task 9 review fix`)
- Final report evidence: `861b44d` (`docs: correct Task 9 smoke evidence`)
- Report finalization: `a3ec8d0` (`docs: finalize Task 9 report`)
