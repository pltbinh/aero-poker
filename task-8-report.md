# Task 8 Report

Date: August 19, 2026

## Scope

Implemented or updated for Task 8:

- `package.json`
- `pnpm-lock.yaml`
- `playwright.config.ts`
- `e2e/room-flow.spec.ts`
- `e2e/reconnect.spec.ts`
- `e2e/accessibility.spec.ts`
- `scripts/assert-no-sockets.mjs`
- `scripts/no-sockets.mjs`
- `test/no-sockets.test.ts`
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

1. Root build script

Command:

```powershell
corepack pnpm build
```

Result:

```text
packages/protocol build$ tsc -p tsconfig.json
Error: spawn EPERM
```

2. Root test script

Command:

```powershell
corepack pnpm test
```

Result:

```text
failed to load config from D:\Projects\scrum-poker\vitest.config.mjs
Error: spawn EPERM
```

3. Focused Playwright room-flow verification outside the sandbox

Command:

```powershell
corepack pnpm test:e2e -- --grep "creator and participants complete a private round over HTTP and EventSource only"
```

Result:

```text
failed to load config from D:\Projects\scrum-poker\apps\web\vite.config.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...vite\misc\true.js'
```

4. Earlier focused Playwright verification attempts

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

- The current checkout fails before any browser journey executes because Vite cannot load `apps/web/vite.config.ts`.
- The exact failure on August 19, 2026 was:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Projects\scrum-poker\node_modules\.pnpm\vite@8.2.1_@types+node@22.20.1_esbuild@0.28.2_jiti@2.7.0\node_modules\vite\misc\true.js'
```

- Because the web build fails before preview startup, the Playwright specs do not reach browser actions, SSE assertions, axe analysis, or Chromium launch.

2. Root test/build limitation

- In the managed sandbox, `corepack pnpm build` and `corepack pnpm test` fail with `spawn EPERM` while starting helper processes on Windows.
- Outside the sandbox, focused Playwright runs proceed further, but still stop at the Vite module-resolution failure above.

3. Browser installation

- `corepack pnpm exec playwright install chromium` was not run during this bounded closeout because the current Playwright path fails before browser launch at Vite config load time.

## Changed Files

- `package.json`
- `pnpm-lock.yaml`
- `playwright.config.ts`
- `e2e/room-flow.spec.ts`
- `e2e/reconnect.spec.ts`
- `e2e/accessibility.spec.ts`
- `scripts/assert-no-sockets.mjs`
- `scripts/no-sockets.mjs`
- `test/no-sockets.test.ts`
- `task-8-report.md`

## Commit

Commit hash: recorded in the final response after creating the required Git commit.
