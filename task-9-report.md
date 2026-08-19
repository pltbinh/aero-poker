# Task 9 Report

Date: Thursday, August 20, 2026

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

After the local smoke:

- verified the test server was isolated to `127.0.0.1:4100` and cleaned up;
- did not perform any production or remote load action.

## Limitations

1. The production five-minute PM2/RSS observation was not run; it requires explicit production approval and remains documentation-only.
2. The build and local smoke logs surface the existing engine warning because some workspace commands use Node `v24.19.0`/pnpm `11.19.0` while the repo declares Node `>=20 <21`.
