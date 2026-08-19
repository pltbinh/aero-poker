# Scrum Poker Design

## Purpose

Build a lightweight Scrum Poker web application for anonymous teams. A facilitator creates a temporary room, shares its link, and controls reveal and reset. Participants vote in real time without accounts, persistent history, WebSockets, Socket.IO, or a database.

The first release prioritizes a friendly interface, correct hidden-vote behavior, simple operations, and conservative protection of its share of the Google Cloud free-tier egress allowance. Because the VM also hosts another public service, application-level controls cannot guarantee the account-wide allowance is never exceeded.

## Product Scope

### Included

- Anonymous, room-scoped participants identified by display name.
- An unguessable room identifier and shareable room URL.
- A fixed deck: `0.5`, `1`, `2`, `3`, `5`, `8`, `13`, `21`, `?`, `☕`.
- Up to 20 participants per room.
- One creator/facilitator who exclusively reveals and resets votes.
- Creator authority and participant identity restored after refresh in the same browser.
- Hidden votes until reveal, with vote changes allowed before reveal.
- Real-time server-to-client synchronization exclusively with Server-Sent Events (SSE) and ordinary HTTP requests. WebSockets and Socket.IO are prohibited.
- Responsive light and dark themes for phone and desktop browsers.
- In-memory rooms removed after one hour without meaningful activity.
- GitHub Pages frontend hosting and an isolated, single-process Express backend sharing the existing GCP VM.

### Excluded

- User accounts, authentication providers, teams, or organization management.
- Persistent rooms, voting history, analytics, or a database.
- Creator handoff, multiple facilitators, spectators, or participant removal.
- Configurable decks, timers, chat, issue-tracker integrations, or vote averages.
- Horizontal scaling or PM2 cluster mode.
- WebSocket or Socket.IO packages, endpoints, client connections, Nginx upgrade rules, or fallback transports.

## Technology and Repository Structure

Use a pnpm TypeScript monorepo:

```text
apps/
  server/       Express API, room state, SSE, and operational endpoints
  web/          React and Vite single-page application
packages/
  protocol/     Shared domain contracts, validation schemas, and wire codecs
deploy/         Nginx, PM2, bandwidth guard, and deployment scripts
docs/           Operations and architecture documentation
```

The frontend uses React, Vite, Tailwind CSS, shadcn/ui components, and Lucide icons. The backend uses Express and runs as exactly one PM2 process because room state is local to one Node.js process. The protocol package exposes readable TypeScript types and confines minified wire keys to explicit encode/decode functions. Dependency checks reject `socket.io`, `socket.io-client`, `ws`, and other WebSocket transports in this project.

## Domain Model

### Room

A room contains:

- `id`: 128 random bits encoded as 22 unpadded base64url characters, suitable for a shared URL.
- `phase`: either `voting` or `revealed`.
- `revision`: a monotonically increasing integer incremented for every accepted mutation.
- `createdAt` and `lastActivityAt`: server timestamps.
- `creatorParticipantId`: the participant controlled by the room creator.
- `facilitatorTokenHash`: the hash of the creator-only bearer token.
- `participants`: an insertion-ordered map keyed by participant ID.

### Participant

A participant contains:

- `id`: 128 random bits encoded as unpadded base64url.
- `displayName`: trimmed display text between 1 and 30 characters.
- `normalizedName`: the case-insensitive uniqueness key.
- `participantTokenHash`: the hash of the participant bearer token.
- `vote`: either a value from the fixed deck or no vote.
- `joinedAt`: a server timestamp.

Participant names must be unique within a room after trimming and case normalization. A room accepts at most 20 participants. A participant remains listed until the room expires; v1 has no explicit leave or removal behavior.

### Credentials

Creation returns a participant token and a separate facilitator token. Joining returns only a participant token. Each bearer token contains 256 cryptographically random bits encoded as unpadded base64url. The server keeps only SHA-256 token hashes and compares hashes with a timing-safe operation.

The browser stores credentials under the room ID in local storage. A shared link contains only the room ID in a hash route such as `#/room/<roomId>`. Loading a known room restores the saved participant seat. A different browser joins as a regular participant and cannot recover facilitator authority from the room URL.

## API

All JSON request bodies are schema-validated and limited to 4 KiB. Stable machine-readable error codes accompany friendly, non-sensitive messages.

### `POST /api/rooms`

Creates a room and its creator participant.

Request:

```json
{ "displayName": "Alex" }
```

Response:

```json
{
  "roomId": "public-room-id",
  "participantToken": "private-participant-token",
  "facilitatorToken": "private-facilitator-token"
}
```

### `POST /api/rooms/:roomId/join`

Creates a participant unless the normalized display name is taken or the room has 20 participants.

Request:

```json
{ "displayName": "Sam" }
```

Response:

```json
{ "participantToken": "private-participant-token" }
```

### `POST /api/rooms/:roomId/stream-tickets`

Authenticates `Authorization: Bearer <participantToken>` and returns a 128-bit cryptographically random, single-use stream ticket valid for 30 seconds. The server stores tickets only until use or expiry.

Response:

```json
{ "ticket": "short-lived-ticket", "expiresInSeconds": 30 }
```

### `GET /api/rooms/:roomId/stream?ticket=...`

Consumes a valid stream ticket and opens an SSE response. On connection, the server emits a complete authoritative snapshot. It then emits a new snapshot after each accepted room mutation. Each event carries the current revision. A comment heartbeat is sent every 30 seconds and does not count as room activity.

Full snapshots are intentionally preferred over a more complex patch protocol because rooms contain at most 20 participants and the compact representation remains small. This avoids missed-delta recovery logic while preserving low bandwidth.

### `POST /api/rooms/:roomId/votes`

Authenticates the participant bearer token and records or changes that participant's vote while the room is in `voting` phase.

Request:

```json
{ "value": "5" }
```

The value must be one of the fixed deck's exact string values.

### `POST /api/rooms/:roomId/reveal`

Requires the creator's participant bearer token plus the facilitator token in `X-Facilitator-Token`. Changes the phase to `revealed`. Repeating the action after reveal is rejected.

### `POST /api/rooms/:roomId/reset`

Requires the same creator credentials. Clears every vote and changes the phase to `voting`. Reset is accepted from either phase, allowing the facilitator to abandon an incomplete round.

### Operational endpoints

- `GET /health/live`: verifies that the Node.js process is alive.
- `GET /health/ready`: verifies that the service can accept requests and is not shutting down or disabled by the bandwidth guard.

## Wire Protocol and Synchronization

Application code uses descriptive types. The protocol package maps snapshots to compact JSON keys only at the SSE boundary. The compact schema is versioned with a small integer so clients can reject unsupported formats explicitly.

Before reveal, participant entries include identity, display name, and a voted boolean but never the selected value. After reveal, entries include vote values. A client must not infer or receive another participant's hidden vote through any endpoint or error response.

The client keeps the highest applied revision and ignores events with a lower or equal revision. On initial connection, reconnect, or return from a hidden tab, a complete snapshot reestablishes authoritative state. The client closes `EventSource` when `document.visibilityState` becomes `hidden`. When visible, it obtains a new stream ticket and reconnects.

Failed connections use exponential backoff starting at 1 second and capped at 30 seconds, with full jitter. The interface shows `connected`, `reconnecting`, or `offline` without clearing the last valid snapshot. User actions that fail due to connectivity remain explicit failures; v1 does not queue mutations for later replay.

## Room Lifecycle

Create, join, vote, reveal, and reset update `lastActivityAt`. SSE connections, heartbeats, stream-ticket creation, page refreshes, and reconnections do not extend room lifetime.

A cleanup job runs every five minutes and removes rooms whose meaningful activity is at least one hour old. Cleanup closes their SSE clients with a final room-expired event before releasing all room and ticket state. Subsequent operations return `ROOM_NOT_FOUND` rather than recreating the room.

Graceful shutdown stops new mutations, marks readiness false, closes SSE streams, clears timers, and exits. A process restart loses every room by design. Deployment and user-facing copy must state that rooms are temporary.

## Error Handling and Abuse Controls

The API uses stable error codes including:

- `INVALID_REQUEST`
- `ROOM_NOT_FOUND`
- `ROOM_FULL`
- `NAME_TAKEN`
- `INVALID_TOKEN`
- `FORBIDDEN`
- `INVALID_VOTE`
- `VOTING_REVEALED`
- `ALREADY_REVEALED`
- `STREAM_TICKET_INVALID`
- `STREAM_TICKET_EXPIRED`
- `RATE_LIMITED`
- `SERVICE_UNAVAILABLE`

The frontend maps these codes to friendly guidance and never displays stack traces. Server logs exclude bearer tokens, facilitator tokens, stream tickets, and request query strings for the stream route.

CORS permits only configured frontend origins. For a GitHub project page, the production origin is `https://<github-owner>.github.io`; the repository path is not part of the browser origin. Rate limits use a one-minute sliding window: 10 room creations per IP, 30 joins per IP, 40 joins per room, 120 vote/reveal/reset actions per participant, and 20 stream tickets per participant. Because the VM already hosts another application, the Scrum Poker process initially accepts at most 250 active rooms and 100 simultaneous SSE connections; excess requests return `SERVICE_UNAVAILABLE`. Responses set defensive headers, and Nginx accepts only HTTPS traffic forwarded to the loopback-bound Node.js process.

## User Experience

### Landing screen

The landing screen asks for a display name and offers two clear actions: create a room or join with a room code. A shared hash-route room URL opens the join flow with the code already populated. Hash routing ensures direct room links work on GitHub Pages without server rewrite support.

### Room screen

The room screen contains:

- A room code and copy-link control.
- A connection-status indicator.
- A participant list showing `waiting` or `voted` during voting.
- Large, tactile cards for the fixed deck.
- A clear selected-card state and the ability to change selection before reveal.
- Reveal and reset controls visible only to the creator.
- Revealed values and a simple frequency distribution after reveal.

The application does not calculate an average because `?` and `☕` are valid choices.

### Visual language and accessibility

Use a warm indigo and teal palette on soft neutral surfaces, rounded panels, readable typography, and restrained selection/hover motion. Support system-driven light and dark themes. Use shadcn/ui primitives for buttons, inputs, dialogs, tooltips, badges, toasts, and skeletons. Use Lucide icons with text labels wherever an icon alone could be ambiguous.

All interactive controls are keyboard operable and have visible focus states. Status never depends on color alone. Voting cards expose their value and selected state to assistive technology. Motion respects `prefers-reduced-motion`. Phone and desktop layouts are first-class acceptance targets.

## Deployment, Coexistence, and Bandwidth Protection

### Frontend

GitHub Actions builds `apps/web` with pnpm and publishes its `dist` directory to GitHub Pages. For a project page at `https://<github-owner>.github.io/<repository>/`, Vite's base path is `/<repository>/`; for a custom Pages domain it is `/`. The app uses hash routing, so a room link remains valid when opened directly without a rewrite rule. Static assets use content hashes. The production build receives the Pages base path, public site URL, and API base URL through validated build-time configuration.

### Backend

The Express server shares the existing GCP Compute Engine VM with the separately deployed `keothom` application. Scrum Poker uses these isolated defaults:

- Application directory: `/opt/scrum-poker` rather than `/opt/keothom`.
- PM2 process: `scrum-poker-backend` rather than `keothom-backend` or `keothom-frontend`.
- Loopback port: `4100` rather than the occupied backend port `4000` or frontend port `4174`.
- Public API hostname: `poker-api.keothom24.com`, handled by its own Nginx server block and certificate.
- Nginx site files: `/etc/nginx/sites-available/scrum-poker` and `/etc/nginx/sites-enabled/scrum-poker`; the existing `keothom` site is not overwritten.

The Scrum Poker deploy script treats Node.js 20, Nginx, Certbot, and PM2 as existing shared prerequisites. It does not reinstall them, change firewall rules, stop Nginx, modify `/opt/keothom`, modify `/var/lib/keothom`, or restart either existing PM2 process. It runs pnpm through Corepack, builds the TypeScript backend, checks that port 4100 is not owned by an unrelated process, installs only the new Nginx site, runs `nginx -t`, and reloads Nginx only after validation succeeds. PM2 starts the compiled backend with a `256M` memory restart ceiling and saves the combined PM2 process list.

TLS provisioning for `poker-api.keothom24.com` uses a distinct certificate and the existing `/var/www/letsencrypt` webroot. It must not stop Nginx or replace the certificate currently serving `keothom24.com` and `www.keothom24.com`.

For the SSE route, the dedicated Nginx server block proxies ordinary HTTP/1.1 to port 4100, disables proxy buffering, caching, and compression, and uses a 75-second proxy read timeout. It contains no `Upgrade` header, `/socket.io/` location, or other WebSocket configuration. The Express response supplies `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. Deployment is not accepted until an SSE connection remains live for five minutes through the real Cloudflare hostname and receives heartbeat comments plus at least one room mutation.

### Egress controls

The deployment assumes an eligible `e2-micro` in `us-west1`, `us-central1`, or `us-east1` and verifies the current Google Cloud Free Tier before rollout. Static files never traverse the VM. Room snapshots use compact wire keys, mutation-only broadcasts, and 30-second comment heartbeats. Hidden tabs disconnect.

`vnstat` tracks monthly bytes transmitted by the shared VM interface, including both Scrum Poker and the existing `keothom` services. A root-owned cron guard checks usage every five minutes and refuses to start or stops `scrum-poker-backend` when total current-calendar-month transmitted bytes reach 900,000,000. It activates a small static maintenance response only for `poker-api.keothom24.com`; it never stops or rewrites the existing application.

This guard limits Scrum Poker after the shared VM approaches the threshold, but it cannot guarantee account-wide egress remains below 1 GB because `keothom` continues serving traffic and `vnstat` does not equal GCP billable egress. A true VM-wide hard stop would require separate operator authorization to stop every public service. Operations therefore also configure Google Cloud budget notifications at 50%, 80%, and 90% of a US$1 monthly budget and inspect billing reports because free-tier terms and billable routing may change.

## Testing Strategy

### Unit tests

- Room creation, name normalization, participant limits, and expiry.
- Allowed and rejected state transitions for vote, reveal, and reset.
- Creator-only authorization and token hashing.
- Stream-ticket issuance, single use, and expiry.
- Snapshot secrecy before reveal and values after reveal.
- Wire-codec round trips and revision filtering.
- Bandwidth-guard threshold parsing, shared-interface accounting, and Scrum-Poker-only state transitions.
- Dependency and generated-config checks proving that this project contains no WebSocket or Socket.IO transport.

### API integration tests

Use Supertest plus a real SSE parser to exercise create, join, ticket, connect, vote, reveal, reset, reconnect, expiry, rate limiting, and graceful shutdown. Tests assert both HTTP results and streamed snapshots.

### Frontend tests

Use Vitest, Testing Library, and user-event for restored credentials, room flows, voting cards, creator controls, error mapping, connection states, tab visibility behavior, theme behavior, and keyboard accessibility.

### End-to-end and operational tests

Use Playwright browser contexts for one creator and multiple participants. Verify that votes remain hidden before reveal, creator controls are exclusive, refresh restores identity, and reconnection converges on the latest revision. Run automated accessibility checks on landing, voting, and revealed states.

A lightweight load test opens five full rooms, for 100 simultaneous SSE connections, while measuring memory and emitted bytes over five minutes. It must avoid connection loss and keep Scrum Poker process RSS below 220 MiB, leaving headroom beneath the PM2 `256M` restart ceiling. Before deployment, an operator records `free -m`, `df -h`, `pm2 list`, and listening ports; deployment stops if the shared VM lacks at least 300 MiB of available memory or 1 GiB of disk space. Production smoke tests cover TLS, CORS from the GitHub Pages origin, Cloudflare proxying, five-minute SSE continuity, PM2 isolation, restart behavior, room loss messaging, and the bandwidth guard's dry-run mode.

## Acceptance Criteria

- A creator can create a temporary room, share its link, refresh, and retain facilitator authority in the same browser.
- Up to 19 additional anonymous participants can join with unique names.
- Every participant can select and change exactly one fixed-deck value before reveal.
- No client or API response exposes another participant's vote before reveal.
- Only the creator can reveal or reset; unauthorized attempts return `FORBIDDEN`.
- All connected, visible clients converge on the same revision after every accepted mutation and after reconnection.
- Hidden tabs close their stream and resynchronize when visible.
- Inactive rooms expire after one hour of meaningful inactivity.
- The interface is responsive, keyboard accessible, usable in light and dark themes, and provides non-color status cues.
- The deployed frontend is served by GitHub Pages with working hash-route room links.
- The backend runs as the isolated `scrum-poker-backend` PM2 process on port 4100 behind its own Nginx site and Cloudflare hostname; deploying or restarting it does not restart, overwrite, or reconfigure the existing `keothom` processes.
- No Scrum Poker dependency, application code, network request, or Nginx rule uses WebSockets or Socket.IO; the production five-minute SSE smoke test passes using `EventSource` and HTTP requests only.
- The bandwidth guard has a tested dry-run mode, stops service at 900 MB when enabled, and leaves an operator-visible maintenance response.
