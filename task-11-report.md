# Task 11 Report: Isolated PM2, Nginx, and Deploy Script

## Summary

Implemented the isolated Scrum Poker deployment assets only. The deployer is fixed to `scrum-poker-backend`, `/opt/scrum-poker`, loopback port `4100`, and `poker-api.keothom24.com`; it reports missing prerequisites without installing packages, validates capacity and the environment boundary, checks port ownership, runs Scrum Poker checks, validates Nginx before reload, and compares KeoThom PM2 status/restart counters without mutating those services.

No production deployment, DNS change, certificate issuance, Nginx reload, PM2 action, or publishing was executed from this checkout.

## Changed files

- `apps/server/.env.example`
- `deploy/ecosystem.config.cjs`
- `deploy/nginx/scrum-poker-http.conf`
- `deploy/nginx/scrum-poker.conf`
- `deploy/deploy.sh`
- `deploy/test/deploy-static.test.mjs`
- `task-11-report.md`

Unrelated worktree changes and generated artifacts were not staged or modified by this task.

## RED evidence

Focused command, using a temporary repository-local Vitest config because the root Vitest config only includes TypeScript tests:

```text
node scripts/run-local-bin.mjs vitest run --config deploy/test/.vitest.config.mjs deploy/test/deploy-static.test.mjs
```

Result before deployment assets existed:

- exit `1`
- `1` test file failed
- `8` tests failed
- failures named the missing `.env.example`, PM2 config, both Nginx configs, and deploy script

This was the intended RED result. The temporary config was removed after verification.

## GREEN evidence

Focused command after implementation:

```text
node scripts/run-local-bin.mjs vitest run --config deploy/test/.vitest.config.mjs deploy/test/deploy-static.test.mjs
```

Result:

- exit `0`
- `1` test file passed
- `8` tests passed

The static suite asserts required-file presence, exact process/path/port/hostname constants, production environment settings, no secrets, SSE HTTP/1.1 and empty `Connection`, buffering/cache/gzip disabled, 75-second read timeout, maintenance JSON 503, ACME bootstrap behavior, Nginx validation before reload, prerequisite reporting, fixed destinations, no broad cleanup, and no socket/upgrade configuration.

Additional verification already run:

```text
bash -n deploy/deploy.sh
node --check deploy/ecosystem.config.cjs
corepack pnpm lint:no-sockets
```

All exited `0`; the socket guard reported `No forbidden socket transports found.`

Full checks already run before this report was written:

- `corepack pnpm test`: exit `0`; root workspace `23` test files / `103` tests, protocol `5`, server `41`, and web `46` tests passed.
- `corepack pnpm typecheck`: exit `0` for protocol, server, and web.
- `corepack pnpm build`: exit `0` for protocol, server, and web.

## Limitations

- The checkout is Windows-based, so the focused `.mjs` test required a temporary local Vitest config; the repository default config does not discover that file.
- The broad Prettier check cannot infer parsers for `.env.example`, Nginx, or Bash files. JavaScript deployment files were checked/formatted with the repository-local Prettier binary.
- The host reported Node `v24.19.0` and pnpm `11.19.0` engine warnings during build; production assets require Node 20 and PM2 as documented.
- Nginx, Certbot, PM2, Ubuntu/Debian prerequisites, DNS, certificates, VM capacity, and production behavior were not exercised from this checkout.

## Commit

Implementation commit message: `ops: isolate scrum poker on shared VM`

Implementation commit hash: `a125dbff609313ef8d16f928415c439221c94dc4`
