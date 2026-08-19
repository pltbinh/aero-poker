# Task 10 Report: GitHub Pages Deployment

## Summary

Implemented Task 10 in the shared checkout by:

- adding a focused Pages artifact and router regression test at `apps/web/test/pages-build.test.ts`
- validating `VITE_BASE_PATH` explicitly in `apps/web/vite.config.ts`
- adding a least-privilege GitHub Pages workflow at `.github/workflows/pages.yml`

No publish, push, GitHub configuration, or production deployment actions were performed.

## Changed Files

- `.github/workflows/pages.yml`
- `apps/web/vite.config.ts`
- `apps/web/test/pages-build.test.ts`
- `task-10-report.md`

## RED Evidence

Direct focused test command on this Windows checkout:

`corepack pnpm exec vitest run apps/web/test/pages-build.test.ts`

Result:

- failed before test execution with `'vitest' is not recognized as an internal or external command`

Repository-local fallback used per brief:

`node scripts/run-local-bin.mjs vitest run apps/web/test/pages-build.test.ts --configLoader runner --pool=threads --poolOptions.threads.singleThread`

Final RED result after fixing the `.ts` test harness shape and build-test timeout:

- `2 passed`
- `2 failed`
- both failures were:
  - `rejects invalid non-root VITE_BASE_PATH values like /scrum-poker`
  - `rejects invalid non-root VITE_BASE_PATH values like scrum-poker/`
- failure detail showed `expected +0 not to be +0`, proving invalid values still built successfully before the config change

That was the intended RED signal for the missing base-path validation.

## GREEN Evidence

Focused Pages suite:

`node scripts/run-local-bin.mjs vitest run apps/web/test/pages-build.test.ts --configLoader runner --pool=threads --poolOptions.threads.singleThread`

Result:

- `1 passed`
- `4 passed`

Exact Pages-base build command from the brief:

`corepack pnpm exec cross-env VITE_BASE_PATH=/scrum-poker/ VITE_API_BASE_URL=https://poker-api.keothom24.com pnpm build`

Result:

- exit `0`
- built `apps/web/dist/index.html`
- built `/scrum-poker/` assets including:
  - `dist/assets/index-C_1r8z-4.css`
  - `dist/assets/index-DEZ-Gnkn.js`

Workspace typecheck:

`corepack pnpm typecheck`

Result:

- exit `0`

No-socket guard:

`corepack pnpm lint:no-sockets`

Result:

- exit `0`
- output: `No forbidden socket transports found.`

Full workspace tests:

`corepack pnpm test`

Result:

- exit `0`
- root/workspace Vitest run: `23 passed`, `103 passed`
- protocol package test: `1 passed`, `5 passed`
- server package test: `7 passed`, `41 passed`
- web package test: `11 passed`, `46 passed`

Full workspace build:

`corepack pnpm build`

Result:

- exit `0`
- protocol, server, and web builds completed successfully

## Artifact Assertions

The focused Pages suite performs a fresh web build with:

- `VITE_BASE_PATH=/scrum-poker/`
- `VITE_API_BASE_URL=https://poker-api.keothom24.com`

It then asserts that `apps/web/dist/index.html`:

- contains a usable root entrypoint: `<div id="root"></div>`
- emits stylesheet and module-script URLs under `/scrum-poker/`
- points those URLs at real files under `apps/web/dist`
- does not leak the workspace filesystem path
- does not contain `file:///` URLs
- does not contain Windows drive-path fragments in the HTML

The same suite also proves the router restores room `abc` from a simulated GitHub Pages hash route at `https://owner.github.io/scrum-poker/#/room/abc`.

## Workflow Validation

Static workflow formatting check:

`node scripts/run-local-bin.mjs prettier --check .github/workflows/pages.yml`

Result:

- exit `0`
- `All matched files use Prettier code style!`

Static workflow content check:

`rg -n "workflow_dispatch|contents: read|pages: write|id-token: write|actions/upload-pages-artifact@v3|actions/deploy-pages@v4|VITE_BASE_PATH: /scrum-poker/|VITE_API_BASE_URL: https://poker-api.keothom24.com|group: github-pages|cancel-in-progress: true|branches:" .github/workflows/pages.yml`

Result:

- exit `0`
- matched the required trigger, permission, environment variable, artifact upload, deploy action, and concurrency lines

Workflow behavior validated in source:

- triggers on `push` to `main` and `workflow_dispatch`
- grants only `contents: read`, `pages: write`, and `id-token: write`
- uses one `github-pages` concurrency group with `cancel-in-progress: true`
- runs `pnpm install --frozen-lockfile`, `pnpm lint:no-sockets`, `pnpm test`, and `pnpm build`
- uploads `apps/web/dist` with `actions/upload-pages-artifact@v3`
- deploys with `actions/deploy-pages@v4`
- contains no secrets, VM commands, DNS/cert commands, socket transports, or backend mutation steps

## Limitations

- The local Windows checkout could not resolve `corepack pnpm exec vitest ...` directly, so the focused test suite used the repository-local binary wrapper as allowed by the brief.
- Local verification emitted engine warnings on commands launched through the host toolchain because the current machine is running Node `v24.19.0` and pnpm `11.19.0`, while the repository declares Node `>=20 <21` and pnpm `10.15.0`. The workflow itself pins Node `20`.
- A Git commit cannot embed its own exact hash in the same committed file content without rewriting history afterward, so the exact commit hash is reported from Git metadata after commit creation rather than embedded here before the commit exists.

## Commit

- Commit message: `ci: deploy frontend to GitHub Pages`
- Exact commit hash: recorded after commit creation in Git metadata and reported alongside this task handoff
