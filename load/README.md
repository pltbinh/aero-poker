# SSE Load Gate

`pnpm test:load -- --base-url=http://127.0.0.1:4100` runs the Task 9 HTTP/SSE load runner against an explicit loopback backend. The runner never defaults to a URL, rejects malformed values, and refuses production-looking hosts such as `https://poker-api.keothom24.com`.

The load shape is fixed at `5` rooms x `20` participants (`100` concurrent SSE clients). The runner:

- creates the same rooms and participants the browser API would create;
- requests one short-lived stream ticket per participant;
- opens `100` `text/event-stream` connections over ordinary HTTP;
- waits for all initial snapshots;
- casts representative votes, reveals, and resets every room;
- keeps the streams open for the configured duration;
- fails on partial setup or an unexpected disconnect; and
- logs aggregate counts only, never participant tokens, facilitator tokens, stream tickets, authorization headers, or authenticated URLs.

## Local 30-second check

Use the server test-start command and the repository-local binary wrapper on this Windows checkout:

```text
node scripts/run-local-bin.mjs start-server-and-test "corepack pnpm --filter @scrum-poker/server start:test" http://127.0.0.1:4100/health/ready "corepack pnpm test:load -- --base-url=http://127.0.0.1:4100 --duration-seconds=30"
```

`apps/server start:test` binds only to `127.0.0.1:4100`, uses explicit local environment variables, and does not point at any production URL.

## Production observation gate

Running any load against production requires explicit human approval and is not part of local verification. The CLI runner intentionally rejects production-looking URLs, so the production gate is a manual observation checklist for the shared VM:

1. Start the approved production load from a separately authorized environment.
2. Observe `scrum-poker-backend` with either `pm2 monit` or `pm2 jlist`.
3. Reject the deployment if peak RSS for `scrum-poker-backend` exceeds `220 MiB`.
4. Reject the deployment if any existing PM2 process restart counter increases during the run.
5. Reject the deployment if available VM memory drops below `100 MiB` at any point during the run.

The intended production observation window is `300` seconds. Record the exact commands, timestamps, peak RSS, restart counters, and free-memory readings in the deployment evidence before approving release.
