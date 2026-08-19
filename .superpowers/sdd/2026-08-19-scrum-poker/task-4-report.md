# Task 4 Report: Express API, Rate Limits, and Lifecycle

Date: 2026-08-19
Commit: `30c243e62fd47ad968b6ccc5ab2e646234e8514d` (`feat: expose scrum poker HTTP and SSE API`)

## RED evidence

Focused API/lifecycle test run before implementation:

```text
FAIL  test/api.test.ts
Error: Cannot find module '../src/app.js' imported from 'D:/Projects/scrum-poker/apps/server/test/api.test.ts'

FAIL  test/lifecycle.test.ts
Error: Cannot find module '../src/index.js' imported from 'D:/Projects/scrum-poker/apps/server/test/lifecycle.test.ts'
```

Notes:
- The brief's `corepack pnpm exec vitest ...` form did not resolve `vitest` correctly in this Windows workspace.
- The focused RED run succeeded via the local workspace Vitest binary with sandbox escalation, and the failure was the expected missing HTTP/runtime surface.

## GREEN evidence

Focused tests:

```text
RUN  v3.2.7 D:/Projects/scrum-poker/apps/server
✓ test/api.test.ts (7 tests)
✓ test/lifecycle.test.ts (4 tests)
Test Files  2 passed (2)
Tests  11 passed (11)
Duration  1.78s
```

Typecheck:

```text
> @scrum-poker/server@0.0.0 typecheck D:\Projects\scrum-poker\apps\server
> tsc -p tsconfig.json --noEmit
```

Build:

```text
> @scrum-poker/server@0.0.0 build D:\Projects\scrum-poker\apps\server
> pnpm --filter @scrum-poker/protocol build && tsc -p tsconfig.build.json
```

Verification summary:
- Focused API/lifecycle suites passed with no open-handle warning.
- Server typecheck passed.
- Server build passed.

## Changed files

- `apps/server/package.json`
- `apps/server/src/app.ts`
- `apps/server/src/config.ts`
- `apps/server/src/index.ts`
- `apps/server/src/rate-limit/sliding-window.ts`
- `apps/server/test/api.test.ts`
- `apps/server/test/lifecycle.test.ts`
- `pnpm-lock.yaml`

## What changed

- Added validated runtime config loading for host, port, CORS origins, and egress-disabled readiness.
- Added a one-minute sliding-window limiter used for create, join-by-IP, join-by-room, participant actions, and stream tickets.
- Added an Express HTTP API with:
  - `POST /api/rooms`
  - `GET /api/rooms/:roomId`
  - `POST /api/rooms/:roomId/join`
  - `POST /api/rooms/:roomId/votes`
  - `POST /api/rooms/:roomId/reveal`
  - `POST /api/rooms/:roomId/reset`
  - `POST /api/rooms/:roomId/stream-ticket`
  - `GET /api/rooms/:roomId/stream`
  - `GET /health/live`
  - `GET /health/ready`
- Wired accepted mutations to publish personalized SSE snapshots through `SseHub`.
- Added server startup/shutdown lifecycle management with heartbeat, room/ticket cleanup, readiness gating, signal handlers, SSE client shutdown, HTTP close, and forced nonzero exit after 10 seconds.
- Added focused integration coverage for API behavior, rate limits, SSE headers/first frame, readiness/liveness, sanitized logging, cleanup timers, graceful signal shutdown, and forced shutdown fallback.

## Self-review

- Kept transport strictly HTTP plus native SSE. No WebSocket or upgrade handling was introduced.
- Used `express.json({ limit: "4kb" })`, Helmet, explicit CORS origin matching, and a centralized API error handler.
- Participant-scoped rate limits are applied only after authentication.
- Stream logs avoid query strings by logging `req.path` rather than the original URL.
- Shutdown removes signal listeners, clears timers, closes SSE clients, and stops the HTTP server.

## Concerns

- The focused Vitest run requires using the local workspace binary with escalation in this environment because `pnpm exec vitest` did not resolve correctly and sandboxed config loading hit `spawn EPERM`.
- Build output warns that the active runtime is Node `v24.19.0` / pnpm `11.19.0` while the repo engine targets Node `>=20 <21`; the build still passed.

## Fix round 1

Base commit reviewed: `30c243e62fd47ad968b6ccc5ab2e646234e8514d`

### Additional RED evidence

Focused fix-round test run before changes:

```text
FAIL  test/lifecycle.test.ts > startServer > logs startup failures without printing raw error details or stack traces
AssertionError: expected undefined to be type of 'function'

FAIL  test/sliding-window.test.ts > SlidingWindowRateLimiter > evicts expired keys when newer requests arrive
AssertionError: expected [ 'fresh', 'stale' ] to deeply equal [ 'fresh' ]
```

Notes:
- The new personalized stream-update API/SSE regression test passed immediately, which confirmed the existing mutation broadcast path already produced personalized complete snapshots after accepted mutations.
- The new one-minute rollover rate-limit test also passed immediately, so the limiter window boundary itself was already correct; only stale-key eviction was missing.

### Additional GREEN evidence

Focused fix-round suites:

```text
RUN  v3.2.7 D:/Projects/scrum-poker/apps/server
✓ test/lifecycle.test.ts (5 tests)
✓ test/sliding-window.test.ts (2 tests)
✓ test/api.test.ts (8 tests)
✓ test/sse-hub.test.ts (8 tests)
Test Files  4 passed (4)
Tests  23 passed (23)
Duration  1.24s
```

Typecheck:

```text
> @scrum-poker/server@0.0.0 typecheck D:\Projects\scrum-poker\apps\server
> tsc -p tsconfig.json --noEmit
```

Build:

```text
> @scrum-poker/server@0.0.0 build D:\Projects\scrum-poker\apps\server
> pnpm --filter @scrum-poker/protocol build && tsc -p tsconfig.build.json
```

### Fix-round changes

- Added `runServerMain(...)` in `apps/server/src/index.ts` so startup failures can be logged through an injected logger with a safe code-only message instead of printing raw `Error` objects or stack traces.
- Changed sliding-window eviction in `apps/server/src/rate-limit/sliding-window.ts` to prune expired buckets before each consume, which bounds inactive-key growth and preserves the existing one-minute rate-limit boundary.
- Added regression coverage for:
  - safe startup failure logging
  - expired rate-limit bucket eviction
  - one-minute window rollover
  - personalized complete SSE snapshots after accepted API mutations
