# Task 12 implementation report

## Scope

Implemented the requested egress guard, native HTTP/SSE smoke probe, hardened
inactive systemd timer, fixture-driven guard test, operations runbook, and this
evidence report. No production, VM, DNS, TLS, PM2, Nginx, systemd, or network
action was executed.

Unrelated pre-existing worktree changes were preserved, including `idea.txt`,
generated dependency/build directories, test results, and the prior Task 1
report.

## TDD evidence

### RED

Command:

```text
bash deploy/test/egress-guard.test.sh
```

Exact result before the guard existed:

```text
exit=1
FAIL: egress guard is executable
```

The test was written before `deploy/scripts/egress-guard.sh` was added.

### GREEN attempt and limitation

Command:

```text
bash deploy/test/egress-guard.test.sh
```

Exact result after implementation:

```text
exit=1
FAIL: jq is available
```

The local Windows workspace has no `jq` executable, and the available WSL
launcher was denied by the environment. The fixture suite therefore could not
reach its behavioral assertions. This is an environment limitation, not a
passing GREEN result; run the same command on the target Linux toolchain after
installing the approved `jq` prerequisite. No dependency was downloaded or
installed during this task.

## Verification evidence

Passed locally:

```text
bash -n deploy/scripts/egress-guard.sh                 exit=0
node --check deploy/scripts/smoke-sse.mjs              exit=0
corepack pnpm lint:no-sockets                          exit=0
No forbidden socket transports found.
node deploy/scripts/smoke-sse.mjs --base-url=http://127.0.0.1:4100
exit=1 with: refusing non-HTTPS base URL; pass --allow-http for an explicit local check
```

Not run by design:

- `smoke-sse.mjs` against any API, because it would make network/production
  calls.
- systemd enable/start, PM2, Nginx, DNS, TLS, vnstat collection, or VM
  commands.
- full repository test/build/e2e commands, because the requested handoff was
  limited to Task 12 and the worktree contains unrelated generated artifacts.

## Review checklist

- Guard parses the newest monthly `vnstat --json m 1` value with `jq` and fails
  closed on malformed or missing data.
- Threshold comparison is inclusive at `900000000` bytes.
- `VNSTAT_COMMAND`, `PM2_COMMAND`, `FLAG_FILE`, `DRY_RUN`, and
  `THRESHOLD_BYTES` are injectable.
- Dry-run does not create the flag or invoke PM2.
- Mutation targets only `/var/lib/scrum-poker/egress-disabled` by default and
  only `scrum-poker-backend`; it never clears the flag.
- Smoke probe uses native Node `http`/`https`, explicit `--allow-http` for
  non-HTTPS URLs, unique room data, one vote, a newer revision, production
  defaults of 300 seconds and 9 heartbeats, bounded local overrides, and
  credential-free output.
- Systemd files are root-owned at installation, hardened, five-minute timer
  units, and were not enabled or started locally.
- Runbook covers Pages/API/CORS, Cloudflare DNS/TLS, prerequisites,
  predeploy/deploy/rollback, health/SSE/load, room loss, redacted logs, PM2/RSS,
  vnstat/guard, US$1 budget alerts at 50/80/90%, shared-interface limits, and
  month-boundary recovery with approval gates.

## Commit hash

Implementation commit hash: `84b38c41de3fd7d31283d8af6df1a4ff2d8b44c1`
