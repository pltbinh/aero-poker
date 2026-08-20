# Scrum Poker operations runbook

This runbook covers the static GitHub Pages frontend and the single-process
Scrum Poker API on the shared KeoThom VM. It is intentionally conservative:
the API owns temporary in-memory rooms, and a restart loses every room.

## Safety and approval gates

Commands marked **PRODUCTION — APPROVAL REQUIRED** are examples for the
operator to run on the VM only after the deployment owner approves the exact
command and target. They were not run while preparing this repository. Do not
copy credentials, bearer tokens, stream tickets, `.env` contents, or raw
request URLs into tickets, chat, CI logs, or deployment notes.

The egress guard is a shared-VM circuit breaker, not an account-wide quota
enforcer. It observes the selected VM interface's monthly transmitted byte
counter. At or above `900000000` bytes it creates only
`/var/lib/scrum-poker/egress-disabled` and stops only the PM2 process named
`scrum-poker-backend`. It cannot stop or cap KeoThom traffic on the same
interface, so continued KeoThom egress can still consume the account budget.

## Production shape and prerequisites

Expected values:

| Item | Value |
| --- | --- |
| Checkout | `/opt/scrum-poker` |
| Backend process | `scrum-poker-backend` (exact PM2 name) |
| Backend bind | `127.0.0.1:4100` |
| API hostname | `poker-api.keothom24.com` |
| Maintenance flag | `/var/lib/scrum-poker/egress-disabled` |
| Guard threshold | `900000000` transmitted bytes for the newest month |
| Guard cadence | every five minutes |
| SSE heartbeat | one comment every 30 seconds |

The VM must be an eligible Google Cloud free-tier `e2-micro` in an eligible
US region, with at least 300 MiB available memory and 1 GiB free disk before a
deploy. Verify the current Google Cloud free-tier terms separately; do not
assume that a previous month's eligibility continues unchanged.

Install or verify only the missing prerequisites once. The deploy script does
not reinstall Node.js, Nginx, PM2, or the package manager:

```bash
# PRODUCTION — APPROVAL REQUIRED; run on the VM, not in this checkout.
sudo apt-get update
sudo apt-get install -y jq vnstat
command -v node pm2 nginx certbot corepack git vnstat jq ss free df awk install systemctl
node --version                         # Node.js major version 20
pm2 --version
```

Resolve the VM interface used for the public traffic and initialize vnstat
for that interface before enabling the timer. Use the actual interface name;
do not guess `eth0`:

```bash
# PRODUCTION — APPROVAL REQUIRED.
ip -br link
ip route get 1.1.1.1
sudo vnstat --add -i <public-interface>
sudo systemctl enable --now vnstat
sudo vnstat --json m 1 | jq -e '.interfaces[0].traffic.month | length > 0'
```

The guard consumes the newest entry in `interfaces[0].traffic.month`. A
malformed response, missing interface/month array, invalid date, or missing
`tx` fails closed and does not stop a process or create the flag.

## GitHub Pages and API origin

1. In the repository's GitHub Pages settings, choose **GitHub Actions** as
   the source.
2. Build the web app with the repository's project-page base path. The normal
   URL shape is `https://<github-owner>.github.io/scrum-poker/`.
3. Use hash-route links such as
   `https://<github-owner>.github.io/scrum-poker/#/room/<room-id>` so direct
   room links do not require a Pages rewrite.
4. Build with the API base URL `https://poker-api.keothom24.com`.
5. Set the API's exact CORS origin to
   `https://<github-owner>.github.io` — the `/scrum-poker/` path is not part of
   the browser origin.

The Pages site is static. Static assets must not be routed through the VM.
Confirm the deployed asset paths include `/scrum-poker/` and that the browser
network panel shows ordinary HTTP requests plus native EventSource/SSE, with
no WebSocket or Socket.IO request.

## Cloudflare DNS and TLS

Create or verify a proxied DNS record for `poker-api.keothom24.com` pointing to
the existing VM's public address. Do not change KeoThom records. Use
Cloudflare SSL/TLS **Full (strict)** and keep the origin certificate valid.
The repository's Nginx bootstrap site serves ACME HTTP-01 challenges; the
production site terminates TLS and proxies only to `127.0.0.1:4100`.

The first certificate bootstrap is an approval-gated operation. Confirm DNS
propagation and the intended hostname before running it:

```bash
# PRODUCTION — APPROVAL REQUIRED.
cd /opt/scrum-poker
sudo install -d -m 0755 /var/www/letsencrypt
sudo install -m 0644 deploy/nginx/scrum-poker-http.conf /etc/nginx/sites-available/scrum-poker
sudo ln -sfn /etc/nginx/sites-available/scrum-poker /etc/nginx/sites-enabled/scrum-poker
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt \
  -d poker-api.keothom24.com --non-interactive --agree-tos --register-unsafely-without-email
```

After the certificate exists, install the production Nginx file, run
`nginx -t`, and reload Nginx. Never add `Upgrade`, WebSocket, or Socket.IO
configuration. The SSE location must retain buffering/cache/compression off
and a 75-second proxy read timeout.

## Predeploy capture

Create a timestamped, access-controlled capture before touching the checkout
or services. Redact hostnames, addresses, environment values, and any
credential-like data before sharing it:

```bash
# PRODUCTION — APPROVAL REQUIRED.
capture="/root/scrum-poker-predeploy-$(date -u +%Y%m%dT%H%M%SZ).txt"
umask 077
{
  date -u
  free -m
  df -h /opt
  ss -ltnp
  pm2 list
  pm2 jlist | jq '[.[] | {name, status: .pm2_env.status, restart_time: .pm2_env.restart_time, memory: .monit.memory}]'
  pm2 jlist | jq '[.[] | select(.name == "keothom-backend" or .name == "keothom-frontend") |
    {name, status: .pm2_env.status, restart_time: .pm2_env.restart_time}]'
  sudo vnstat --json m 1 | jq '.interfaces[0].traffic.month | max_by(.date.year * 12 + .date.month) | {date, tx}'
} >"${capture}"
```

Stop before deployment if available memory is below 300 MiB, free disk is
below 1 GiB, port 4100 is owned by an unrelated process, either KeoThom
process is offline, or the newest monthly `tx` counter is at or above the
guard threshold.

## Guard installation and timer

Install the script and units as root-owned files. The service is intentionally
`Type=oneshot`; the timer invokes it every five minutes. `ProtectSystem=strict`
is opened only for the Scrum Poker state directory, and the service has no
network address family beyond local Unix IPC. The PM2 target is an exact name.

```bash
# PRODUCTION — APPROVAL REQUIRED.
cd /opt/scrum-poker
sudo install -d -o root -g root -m 0755 /usr/local/lib/scrum-poker /var/lib/scrum-poker
sudo install -o root -g root -m 0755 deploy/scripts/egress-guard.sh \
  /usr/local/lib/scrum-poker/egress-guard.sh
sudo install -o root -g root -m 0644 deploy/systemd/scrum-poker-egress-guard.service \
  /etc/systemd/system/scrum-poker-egress-guard.service
sudo install -o root -g root -m 0644 deploy/systemd/scrum-poker-egress-guard.timer \
  /etc/systemd/system/scrum-poker-egress-guard.timer
sudo systemctl daemon-reload
sudo systemctl start --wait scrum-poker-egress-guard.service
sudo systemctl enable --now scrum-poker-egress-guard.timer
sudo systemctl status --no-pager scrum-poker-egress-guard.timer
```

The first service run is approval-gated because it reads the shared counter.
For a non-mutating preflight, inject a fixture command and temporary flag
path, set `DRY_RUN=true`, and verify output names only
`scrum-poker-backend`. Never use `pm2 stop all`. Never point `FLAG_FILE` at a
KeoThom path. The guard never clears its own flag.

## Deploy

The deploy script requires no arguments, validates the platform and capacity,
checks the environment and Nginx inputs, runs the local quality gates, installs
the bootstrap or production site as needed, and starts/restarts only
`scrum-poker-backend`. It also compares KeoThom status and restart counters
before and after.

```bash
# PRODUCTION — APPROVAL REQUIRED; review the exact checkout and .env first.
cd /opt/scrum-poker
git status --short
git fetch --prune origin
git log -1 --oneline
sudo ./deploy/deploy.sh
```

If the script reports a failed preflight, do not bypass it. Resolve the
reported condition, repeat the predeploy capture, and obtain approval for a
new attempt. Do not reinstall unrelated services or edit KeoThom Nginx/PM2
configuration.

## Rollback

Rollback restores only the prior Scrum Poker checkout and configuration. It
does not reset the repository broadly and does not restart KeoThom:

```bash
# PRODUCTION — APPROVAL REQUIRED.
cd /opt/scrum-poker
git status --short
git log --oneline -5
git worktree add /opt/scrum-poker-rollback <known-good-commit>
sudo rsync -a --delete --exclude='.git' /opt/scrum-poker-rollback/ /opt/scrum-poker/
sudo nginx -t
pm2 restart scrum-poker-backend --update-env
pm2 save
```

Before using the example, confirm that the checkout contains the intended
`.env`, ecosystem file, Nginx files, and built server output. If the egress
flag exists, preserve it during rollback; a rollback must not silently reopen
the service above the budget threshold. Remove the temporary rollback
worktree only after the operator confirms it is no longer needed.

## Health, SSE, and load gates

Run health checks without credentials. A healthy API is not enough: the real
Cloudflare path and a five-minute SSE stream are required before declaring the
deployment usable.

```bash
# PRODUCTION — APPROVAL REQUIRED.
curl --fail --silent --show-error https://poker-api.keothom24.com/health/live
curl --fail --silent --show-error https://poker-api.keothom24.com/health/ready
node deploy/scripts/smoke-sse.mjs --base-url=https://poker-api.keothom24.com
corepack pnpm test:load -- --base-url=https://poker-api.keothom24.com --duration-seconds=300
```

The smoke probe creates one unique temporary room, obtains one short-lived
ticket, opens native HTTP/SSE, casts exactly one vote, observes a newer room
revision, remains connected for 300 seconds, and requires at least nine
heartbeats. It prints only aggregate timing/count information. Do not pass
production tokens on a command line or log stream URLs.

For bounded local checks, use an explicitly local HTTP URL and explicit
overrides. These overrides are not production semantics:

```bash
SMOKE_DURATION_SECONDS=5 \
SMOKE_MIN_HEARTBEATS=1 \
SMOKE_HEARTBEAT_INTERVAL_SECONDS=1 \
node deploy/scripts/smoke-sse.mjs --base-url=http://127.0.0.1:4100 --allow-http
```

## Restart and room-loss behavior

Rooms are in memory by design. Any PM2 restart, deploy, rollback, crash, or
VM restart closes SSE connections and loses all rooms. The frontend must show
room-not-found guidance rather than implying that a room can be recovered.
Warn users before an approved restart and ask them to record any votes they
need. Verify after restart that only Scrum Poker's process changed and that
KeoThom restart counters are unchanged.

## Logs, PM2, and RSS monitoring

Application logs intentionally record request methods/paths and status, not
authorization headers, facilitator tokens, stream tickets, or stream query
strings. Treat all logs as sensitive anyway. Before sharing logs, redact
tokens, room identifiers if they are being treated as sensitive, IPs, and
query strings:

```bash
# PRODUCTION — APPROVAL REQUIRED; review and redact locally before sharing.
pm2 list
pm2 describe scrum-poker-backend
pm2 logs scrum-poker-backend --lines 100 --nostream
pm2 jlist | jq '[.[] | select(.name == "scrum-poker-backend") |
  {name, status: .pm2_env.status, restart_time: .pm2_env.restart_time, memory: .monit.memory}]'
```

Keep Scrum Poker RSS below 220 MiB during the 100-client load gate; the PM2
restart ceiling is 256 MiB. Investigate repeated restarts, growing RSS,
increasing 5xx responses, or SSE disconnects before expanding capacity. The
shared VM has one backend process because room state is process-local; adding
PM2 replicas would split room state and is out of scope.

## Egress guard, vnstat, and budget alerts

Inspect the newest monthly value before a deploy and after a guard event:

```bash
# PRODUCTION — APPROVAL REQUIRED.
sudo vnstat --json m 1 | jq -e '
  .interfaces[0].traffic.month
  | max_by(.date.year * 12 + .date.month)
  | {year: .date.year, month: .date.month, transmitted_bytes: .tx}'
sudo systemctl status --no-pager scrum-poker-egress-guard.timer
sudo journalctl -u scrum-poker-egress-guard.service --since '-2 hours' --no-pager
```

The comparison is inclusive: `900000000` is already over the safety line.
Malformed or missing vnstat data fails closed. Dry-run mode may be used with
fixture commands to validate the decision without creating the flag or
calling PM2. The production guard must never be used to stop all PM2 apps.

Configure Google Cloud budget notifications for the relevant billing account
at 50%, 80%, and 90% of **US$1**. Alert recipients should include the service
owner and deployment owner. Budget alerts are advisory and may lag actual
usage; retain the guard and the shared-interface warning as separate controls.

## Month-boundary recovery

The flag is deliberately not cleared automatically. At the beginning of a new
month, first verify that vnstat is reporting the new month and that its counter
is below the threshold. If vnstat still reports the prior month, fix collection
or wait for the correct counter; do not reopen the API based on the calendar
alone.

```bash
# PRODUCTION — APPROVAL REQUIRED; verify the new-month value before each command.
sudo vnstat --json m 1 | jq -e '
  .interfaces[0].traffic.month
  | max_by(.date.year * 12 + .date.month)
  | select(.tx < 900000000)
  | {date, tx}'
sudo test -f /var/lib/scrum-poker/egress-disabled
sudo rm -- /var/lib/scrum-poker/egress-disabled
pm2 start scrum-poker-backend
pm2 save
curl --fail --silent --show-error https://poker-api.keothom24.com/health/ready
node deploy/scripts/smoke-sse.mjs --base-url=https://poker-api.keothom24.com
```

The recovery removes exactly the Scrum Poker flag and starts exactly
`scrum-poker-backend`. It must not touch `/var/lib/keothom*`, KeoThom PM2
processes, or unrelated Nginx configuration. If the new month's counter is
already at or above the threshold, leave the flag in place and escalate.

## Deployment record

For every approved deployment, record the UTC date, Pages URL, API hostname,
checkout commit, health results, five-minute smoke result, load result and
peak RSS, current vnstat reading, and KeoThom before/after PM2 restart
counters. Store only redacted aggregate evidence. Record rollback and
month-boundary recovery actions separately; never claim the shared-interface
guard proves that account-wide egress is capped.
