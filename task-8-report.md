# Task 8 Report

Date: August 19, 2026

## Scope

Implemented or updated for Task 8:

- `package.json`
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `playwright.config.ts`
- `e2e/room-flow.spec.ts`
- `e2e/reconnect.spec.ts`
- `e2e/accessibility.spec.ts`
- `scripts/assert-no-sockets.mjs`
- `scripts/no-sockets.mjs`
- `scripts/run-local-bin.mjs`
- `test/no-sockets.test.ts`
- `test/review-regressions.test.ts`
- `task-8-report.md`

Excluded from staging and preserved as-is:

- `idea.txt`
- `.superpowers/sdd/2026-08-19-scrum-poker/task-1-report.md`
- generated `dist/`, `node_modules/`, and `test-results/` artifacts

## RED Evidence

1. Guard unit test before dependency install

Command:

```powershell
corepack pnpm exec vitest run test/no-sockets.test.ts
```

Result:

```text
'vitest' is not recognized as an internal or external command,
operable program or batch file.
```

2. Placeholder E2E command before Task 8 wiring

Command:

```powershell
corepack pnpm test:e2e
```

Result:

```text
test:e2e is not yet implemented.
```

## Dependency Wiring

Command:

```powershell
corepack pnpm install --force
```

Result:

```text
Done in 1m 17.2s using pnpm v10.15.0
```

Notes:

- Installed `@playwright/test` and `@axe-core/playwright`
- Refreshed `pnpm-lock.yaml`
- PNPM warned that build scripts for `esbuild` were ignored unless explicitly approved

## Round 1 Review Fixes

1. Root command resolution

- Root `test`, `build`, and `typecheck` scripts now use Corepack-pinned pnpm for workspace delegation.
- Root `test` and `test:e2e` invoke repository-local `.bin` executables through `scripts/run-local-bin.mjs`, avoiding Windows `pnpm exec` command lookup failures.
- `test/review-regressions.test.ts` verifies both local runner resolutions with executable smoke checks.

2. Vite dependency mismatch

- The web workspace was pinned from Vite `^8.2.1` to Vite `7.3.6`, and `@vitejs/plugin-react` was aligned to `^5.0.4`.
- Vite `8.2.1` in the original install was missing its package `misc/true.js` conditional-export target; Vite `7.3.6` includes the target and loads the existing config without weakening E2E coverage.
- The same regression test imports Vite from the web workspace and fails if the dependency cannot load.

## Round 2 Review Fixes

- RED evidence from the initial Chromium run: `corepack pnpm test:e2e` produced 3 failures and 1 not-run test. Accessibility and room-flow failed because the accessible name `5` matched both `0.5` and `5`; reconnect failed because `setOffline(true)` alone left the UI at `Live connection active` and never exposed the offline cue.
- The first deterministic offline attempt then failed at reconnect because stopping/restarting the API destroyed the in-memory room; the exact result was a timeout waiting for `Live connection active` at `e2e/reconnect.spec.ts:201`.
- Exact card assertions now use `getByRole("button", { name, exact: true })` and assert a single matching card, avoiding the `5`/`0.5` accessible-name collision.
- The first reconnect journey keeps the API and room alive, uses a tracked browser EventSource error while the context is offline, asserts the exact offline cue and reconnect control, then restores network and reconnects after advancing the room revision from a separate online participant.
- The separate restart journey remains the room-expiry test and still stops/restarts the in-memory API.
- E2E harness builds now invoke Corepack pnpm, and the local runner preserves Windows argument boundaries for forwarded Playwright options.

## Final Reducer Fix

- RED: `& .\apps\web\node_modules\.bin\vitest.CMD run test/room-reducer.test.ts` produced 1 failed and 2 passed because an equal-revision snapshot left the state reconnecting with its prior error.
- The reducer now treats only lower revisions as stale; an equal revision retains the current snapshot while setting `status: "connected"` and clearing `lastError`.
- The reconnect E2E journey no longer uses the temporary offline participant subjourney; it verifies reconnection to the unchanged room revision directly.

## Guard Verification

1. Clean repository pass

Command:

```powershell
node scripts/no-sockets.mjs
```

Result:

```text
No forbidden socket transports found.
```

2. Required negative-path fixture demonstration

Temporary fixture added:

`apps/web/src/socket-fixture.ts`

Command:

```powershell
node scripts/no-sockets.mjs
```

Result:

```text
apps\web\src\socket-fixture.ts: new\s+WebSocket\s*\(
```

Cleanup:

- Removed only `apps/web/src/socket-fixture.ts` with `apply_patch`

Re-run command:

```powershell
node scripts/no-sockets.mjs
```

Result:

```text
No forbidden socket transports found.
```

## Bounded Verification Runs

1. Focused review regressions

Command:

```powershell
& .\node_modules\.bin\vitest.CMD run test/review-regressions.test.ts test/no-sockets.test.ts --config vitest.config.mjs
```

Result:

```text
Test Files  2 passed (2)
Tests  6 passed (6)
```

2. Root unit/integration test script

Command:

```powershell
corepack pnpm test
```

Result:

```text
Test Files  22 passed (22)
Tests  98 passed (98)
```

3. Workspace typecheck

Command:

```powershell
corepack pnpm typecheck
```

Result:

```text
packages/protocol typecheck: Done
apps/server typecheck: Done
apps/web typecheck: Done
```

4. Workspace build

Command:

```powershell
corepack pnpm build
```

Result:

```text
packages/protocol build: Done
apps/server build: Done
apps/web build: Done
vite v7.3.6 building client environment for production...
```

5. Historical Playwright command resolution/listing

Command:

```powershell
corepack pnpm test:e2e -- --list
```

Result:

```text
Running 4 tests using 1 worker
3 failed
1 did not run
```

This was the round-1 bounded result: the command resolved the local Playwright binary and reached browser launch, but Chromium was not yet installed:

```text
browserType.launch: Executable doesn't exist at C:\Users\Admin\AppData\Local\ms-playwright\chromium_headless_shell-1234\chrome-headless-shell-win64\chrome-headless-shell.exe
```

6. Guard

Command:

```powershell
node scripts/no-sockets.mjs
```

Result:

```text
No forbidden socket transports found.
```

7. Earlier bounded verification attempts

Commands:

```powershell
corepack pnpm test:e2e -- --grep "creator and participants complete a private round over HTTP and EventSource only"
```

Observed pre-browser harness failures before the final bounded run:

- `spawn EPERM` while Playwright attempted to start its worker inside the sandbox
- `spawn EINVAL` while the harness tried to launch workspace-scoped build commands on Windows
- `Cannot find module 'D:\Projects\scrum-poker\apps\web\node_modules\vite\bin\vite.js'` before switching to the root-installed Vite binary

8. Round 2 targeted Chromium regressions

Commands:

```powershell
corepack pnpm test:e2e -- --grep "creator and participants complete a private round over HTTP and EventSource only"
corepack pnpm test:e2e -- --grep "landing, voting, and revealed views stay accessible on a narrow viewport"
corepack pnpm test:e2e -- --grep "shows recovery messaging when the browser goes offline and reconnects on demand"
```

Results:

```text
room-flow: 1 passed
accessibility: 1 passed
reconnect: 1 passed
```

9. Round 2 full Chromium acceptance

Command:

```powershell
corepack pnpm test:e2e
```

Result:

```text
4 passed (35.1s)
```

10. Final reducer-fix verification

Web tests:

```powershell
corepack pnpm --filter @scrum-poker/web test
```

```text
Test Files  10 passed (10)
Tests  42 passed (42)
```

Web typecheck and build:

```powershell
corepack pnpm --filter @scrum-poker/web typecheck
corepack pnpm --filter @scrum-poker/web build
```

Results:

```text
typecheck: passed
vite v7.3.6 build: passed
```

Final full Chromium acceptance:

```powershell
corepack pnpm test:e2e
```

```text
4 passed (35.7s)
```

## Current Limitations

- No remaining Task 8 verification blocker: the full local Chromium Playwright suite, unit/integration suite, typecheck, build, and no-sockets guard all pass.
- Earlier round-1 `spawn EPERM`, Vite module-resolution, and missing-Chromium results are retained above as historical evidence only.

## Changed Files

- `package.json`
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `playwright.config.ts`
- `e2e/room-flow.spec.ts`
- `e2e/reconnect.spec.ts`
- `e2e/accessibility.spec.ts`
- `apps/web/src/room/room-reducer.ts`
- `apps/web/test/room-reducer.test.ts`
- `scripts/assert-no-sockets.mjs`
- `scripts/no-sockets.mjs`
- `scripts/run-local-bin.mjs`
- `test/no-sockets.test.ts`
- `test/review-regressions.test.ts`
- `task-8-report.md`

## Commit

Task 8 implementation commit: `d8c53087dccc474534ffcf861f085b402a56db7c`

Round 1 review fix commit: `f4b2e20` (`fix: restore Windows Task 8 verification commands`).

Round 2 E2E fix commit: `fe184773e03791fbfcf4deafc062b0aad6890976` (`fix: stabilize Task 8 Chromium journeys`).

Final reducer fix commit: `d015669` (`fix: restore equal-revision reconnect state`).
