# Task 11 Report: Isolated PM2, Nginx, and Deploy Script

## Summary

Fresh review fixes harden the existing isolated Scrum Poker deployment without changing production state. The deployer now parses `apps/server/.env` with an exact allowlist for `NODE_ENV`, `HOST`, `PORT`, `CORS_ORIGINS`, and `EGRESS_DISABLED_FILE`; rejects unknown, duplicate, malformed, whitespace-bearing, command-substitution, `PATH`, `PM2_HOME`, and wrong-value input; and exports only the validated `CORS_ORIGINS` value.

It validates a same-name PM2 process through `pm2 jlist` and `jq` before trusting port 4100 or restarting it, requiring exactly one online entry with the expected cwd and executable path. A wrong, stale, or offline same-name entry fails closed; when no valid entry exists, `ss` must show port 4100 is free before starting.

The permanent deployment Vitest config is committed and the focused deployment suite runs from `run_scrum_poker_checks` after the authoritative frozen install/test/no-socket/build gates. `systemctl` is now a required prerequisite. No deployment, Nginx reload, PM2, Certbot, DNS, or production action was executed.

## Changed files

- `deploy/deploy.sh`
- `deploy/test/deploy-static.test.mjs`
- `deploy/test/vitest.config.mjs`
- `task-11-report.md`

The authoritative implementation commit `a125dbff609313ef8d16f928415c439221c94dc4` with subject `ops: isolate scrum poker on shared VM` was preserved. Unrelated worktree changes, generated artifacts, `idea.txt`, prior SDD reports/ledger, and application source were not staged.

## RED evidence

Focused command through the repository-local wrapper:

```text
node scripts/run-local-bin.mjs vitest run --config deploy/test/vitest.config.mjs deploy/test/deploy-static.test.mjs
```

The first Windows sandbox attempt exited `1` before test collection because Vitest's config loader could not spawn esbuild (`spawn EPERM`). Retrying the same command outside the sandbox produced the meaningful pre-fix RED result:

- exit `1`
- 1 test file failed
- 11 tests: 5 failed, 6 passed
- failures covered missing focused-suite invocation, missing `systemctl`, missing exact Nginx reload pairing, missing allowlisted parser, and missing PM2 identity validation

## GREEN evidence

Focused deployment suite after implementation:

```text
node scripts/run-local-bin.mjs vitest run --config deploy/test/vitest.config.mjs deploy/test/deploy-static.test.mjs
```

Result: exit `0`; 1 file passed; 11/11 tests passed.

Additional verification:

- `bash -n deploy/deploy.sh`: exit `0`
- `node --check deploy/ecosystem.config.cjs`: exit `0`
- `node --check deploy/test/deploy-static.test.mjs`: exit `0`
- `node --check deploy/test/vitest.config.mjs`: exit `0`
- `git diff --check`: exit `0`
- `corepack pnpm lint:no-sockets`: exit `0`; `No forbidden socket transports found.`
- `corepack pnpm test`: exit `0`; root 23 files/103 tests, protocol 5 tests, server 41 tests, and web 46 tests passed

The static suite now asserts exactly one PM2 app block/name, PM2 identity fields and fail-closed behavior, `systemctl` prerequisites, parser rejection safeguards and no `source`/`eval`, permanent deployment-suite invocation, install → test → lint:no-sockets → build order, and one-to-one `nginx -t` validation before every reload.

## Limitations

- The focused suite required an escalated Windows execution because the sandbox could not spawn Vitest's esbuild config loader.
- The fix round did not run deployment, frozen install, or build; install/build remain in the deploy script in the authoritative order, and generated artifacts were not touched per scope.
- Nginx, Certbot, PM2, Ubuntu/Debian prerequisites, DNS, certificates, VM capacity, and production behavior remain unexercised from this Windows checkout.

## Commit

Fix commit subject: `fix: harden scrum poker deploy guards`
