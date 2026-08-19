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

5. Playwright command resolution/listing

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

The command now resolves the local Playwright binary and reaches browser launch. It is blocked only because Chromium is not installed:

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

## Current Limitations

1. Playwright/browser limitation

- Vite configuration loading and web build now pass.
- The Playwright command reaches browser launch, but the acceptance suite cannot execute because the Chromium binary is not installed in the environment.
- The exact bounded failure on August 20, 2026 was:

```text
browserType.launch: Executable doesn't exist at C:\Users\Admin\AppData\Local\ms-playwright\chromium_headless_shell-1234\chrome-headless-shell-win64\chrome-headless-shell.exe
```

- The three browser tests that require Chromium did not reach browser actions, SSE assertions, or axe analysis; one restart-expiry test was not run because the shared browser setup failed first.

2. Root test/build limitation

- The bounded outside-sandbox test, typecheck, and build commands pass. Earlier managed-sandbox `spawn EPERM` results remain historical environment limitations, not current source failures.

3. Browser installation

- `corepack pnpm exec playwright install chromium` was not run during this bounded closeout; browser download is the remaining prerequisite for full E2E execution.

## Changed Files

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

## Commit

Task 8 implementation commit: `d8c53087dccc474534ffcf861f085b402a56db7c`

Round 1 review fix commit: recorded in the final handoff after commit creation.
