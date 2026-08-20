# Task 12 implementation report

## Scope

Fixed the fresh-review findings in the Task 12 smoke probe, egress-guard
hardening, and fixture/static regression coverage. No production, VM, network,
PM2, Nginx, systemd, DNS, TLS, or service action was executed.

Unrelated pre-existing worktree changes were preserved, including `idea.txt`,
generated dependency/build directories, test results, and the prior Task 1
report.

## TDD evidence

### RED

Regression coverage was added before the implementation changes:

- `deploy/test/deploy-static.test.mjs` asserts explicit 204 handling, continued
  JSON parsing, newer-revision waiting, root PM2 home compatibility, and the
  retained AF_UNIX restriction.
- `deploy/test/egress-guard.test.sh` adds a future invalid-month fixture with a
  valid threshold-exceeding month and requires fail-closed behavior without
  flag creation or PM2 invocation.

Safe direct static assertions run before implementation exited 1 with:

```text
Error: RED: smoke-sse lacks explicit 204 handling
```

The fixture suite could not execute in this Windows workspace: the Bash
launcher was denied before the script ran, and `Get-Command jq` returned no
command. Therefore the fixture's behavioral RED result could not be observed
locally.

### GREEN attempt and limitation

Post-implementation checks that did execute:

```text
bash -n deploy/scripts/egress-guard.sh                 exit=0
bash -n deploy/test/egress-guard.test.sh              exit=0
node --check deploy/scripts/smoke-sse.mjs              exit=0
node --check deploy/test/deploy-static.test.mjs       exit=0
Task 12 direct static assertions passed
git diff --check                                      exit=0
```

The actual Vitest command was attempted but could not start because esbuild
spawned with `EPERM`. The egress-guard fixture command was attempted but the
Bash launcher was denied before reaching its jq prerequisite. The local guard
suite therefore did not pass and is not claimed GREEN; no jq dependency was
downloaded or installed.

## Verification evidence

- `requestJson` now resolves successful 204 responses without JSON parsing and
  still parses JSON for room and stream-ticket responses.
- The smoke probe awaits `stream.revision`, which resolves only when an SSE
  snapshot has `q > initialRevision`, after the vote request.
- The systemd guard uses `ProtectHome=read-only` because root PM2 uses its
  default `/root/.pm2` state/socket; all other hardening,
  including `RestrictAddressFamilies=AF_UNIX`, remains present.
- jq validates every monthly entry's month in the inclusive range 1..12 before
  `max_by`, so an invalid future month fails closed instead of hiding a valid
  counter.

Not run by design:

- `smoke-sse.mjs` against any API or local server, because that would perform a
  network request.
- systemd enable/start, PM2, Nginx, DNS, TLS, vnstat collection, or VM
  commands.

## Reviewed Task 12 implementation commit

`9cef012c30950877edb00e8afd5df01408ff2966`
