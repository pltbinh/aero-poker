# Scrum Poker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a temporary, anonymous Scrum Poker application that synchronizes with SSE and HTTP only, hosts its frontend on GitHub Pages, and safely shares the existing KeoThom GCP VM.

**Architecture:** Use a pnpm TypeScript monorepo with a React/Vite static frontend, an Express backend, and a shared protocol package. The backend owns in-memory rooms in one PM2 process, authenticates HTTP actions with bearer tokens, gives `EventSource` short-lived stream tickets, and emits compact revisioned snapshots. Deployment isolates the service on port 4100 behind its own Nginx hostname and never changes the existing KeoThom processes.

**Tech Stack:** Node.js 20, pnpm, TypeScript, React, Vite, Tailwind CSS, shadcn/ui, Lucide, Express, Zod, Vitest, Testing Library, Supertest, Playwright, PM2, Nginx, GitHub Actions, GitHub Pages, Cloudflare DNS/proxy, Bash, `vnstat`, and `jq`.

**Spec:** `docs/superpowers/specs/2026-08-19-scrum-poker-design.md`

## Global Constraints

- Use only ordinary HTTP requests and Server-Sent Events through native `EventSource`; WebSockets, Socket.IO, upgrade headers, and fallback socket transports are prohibited.
- Use the fixed deck `0.5`, `1`, `2`, `3`, `5`, `8`, `13`, `21`, `?`, `☕`.
- Allow at most 20 participants per room and only the creator to reveal or reset.
- Persist participant and facilitator tokens only in room-scoped browser local storage; never put them in a shared URL or log.
- Delete rooms after one hour without create, join, vote, reveal, or reset activity. Heartbeats and reconnects do not extend room lifetime.
- Run exactly one backend process with at most 250 active rooms, 100 open SSE connections, and a PM2 `256M` memory restart ceiling.
- Host the static frontend on GitHub Pages under the `/scrum-poker/` project path and use hash routes for shareable room links.
- Deploy the backend as `/opt/scrum-poker`, PM2 process `scrum-poker-backend`, loopback port `4100`, hostname `poker-api.keothom24.com`, and a separate Nginx site/certificate.
- Do not modify `/opt/keothom`, `/var/lib/keothom`, the existing KeoThom Nginx site, or the `keothom-backend` and `keothom-frontend` PM2 processes.
- Stop only Scrum Poker when shared-interface transmitted bytes reach `900000000`; document that this cannot guarantee account-wide GCP egress because KeoThom remains live.

## File Structure

```text
.
├── .github/workflows/pages.yml             # Build/test and publish the web app
├── apps/
│   ├── server/
│   │   ├── package.json                     # Backend dependencies and scripts
│   │   ├── tsconfig.json                    # Node TypeScript build
│   │   ├── src/
│   │   │   ├── app.ts                       # Express composition and routes
│   │   │   ├── config.ts                    # Validated runtime configuration
│   │   │   ├── index.ts                     # Process startup and shutdown
│   │   │   ├── auth/tokens.ts               # Token generation, hashing, comparison
│   │   │   ├── errors/api-error.ts           # Stable API error representation
│   │   │   ├── rate-limit/sliding-window.ts  # In-memory rate-limit primitive
│   │   │   ├── rooms/room-store.ts           # Room state machine and expiry
│   │   │   └── streams/
│   │   │       ├── sse-hub.ts                # Connected client registry and broadcast
│   │   │       └── stream-tickets.ts         # Single-use 30-second tickets
│   │   └── test/                              # Unit and API integration tests
│   └── web/
│       ├── package.json                       # Frontend dependencies and scripts
│       ├── vite.config.ts                     # GitHub Pages base path and test config
│       ├── src/
│       │   ├── app.tsx                        # Hash routes and top-level composition
│       │   ├── main.tsx                       # React entrypoint
│       │   ├── index.css                      # Tailwind tokens and theme
│       │   ├── api/room-api.ts                # HTTP client
│       │   ├── auth/room-credentials.ts       # Local-storage boundary
│       │   ├── room/room-reducer.ts           # Revision-safe client state
│       │   ├── room/use-room-connection.ts    # Ticket, EventSource, visibility, retry
│       │   ├── pages/landing-page.tsx          # Create/join flow
│       │   ├── pages/room-page.tsx             # Room orchestration
│       │   └── components/                    # Focused shadcn-based UI components
│       └── test/                               # Component and hook tests
├── packages/protocol/
│   ├── package.json                           # Shared zero-runtime-boundary package
│   ├── src/contracts.ts                       # Domain and API types
│   ├── src/schemas.ts                         # Zod request validation
│   ├── src/wire.ts                            # Compact SSE encoding/decoding
│   └── test/wire.test.ts                      # Secrecy and round-trip tests
├── e2e/                                       # Playwright multi-browser journeys
├── load/sse-load.ts                           # Five-room, 100-client load check
├── deploy/
│   ├── deploy.sh                              # Isolated shared-VM deployment
│   ├── ecosystem.config.cjs                   # Scrum Poker PM2 process only
│   ├── nginx/scrum-poker-http.conf            # Certificate bootstrap server
│   ├── nginx/scrum-poker.conf                 # Production API/SSE proxy
│   ├── scripts/egress-guard.sh                # Shared-interface threshold guard
│   └── scripts/smoke-sse.mjs                  # Five-minute production SSE probe
├── docs/operations.md                         # DNS, TLS, deployment, rollback, monitoring
├── package.json                               # Workspace scripts and tool versions
├── pnpm-workspace.yaml                        # Workspace membership
├── tsconfig.base.json                         # Shared strict TypeScript settings
└── vitest.workspace.ts                        # Test-project discovery
```

---

### Task 1: Workspace and Shared Protocol

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/src/contracts.ts`
- Create: `packages/protocol/src/schemas.ts`
- Create: `packages/protocol/src/wire.ts`
- Create: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/wire.test.ts`

**Interfaces:**
- Produces: `VoteValue`, `RoomPhase`, `ParticipantView`, `RoomSnapshot`, `ApiErrorCode`, request schemas, `encodeSnapshot(snapshot): WireSnapshot`, and `decodeSnapshot(input): RoomSnapshot` from `@scrum-poker/protocol`.
- Consumes: No earlier task.

- [ ] **Step 1: Add the failing wire-contract tests**

```ts
import { describe, expect, it } from "vitest";
import { decodeSnapshot, encodeSnapshot, type RoomSnapshot } from "../src/index.js";

describe("compact room snapshots", () => {
  it("round-trips a revealed room", () => {
    const snapshot: RoomSnapshot = {
      roomId: "room-1",
      revision: 4,
      phase: "revealed",
      selfParticipantId: "p1",
      participants: [
        { id: "p1", displayName: "Alex", hasVoted: true, vote: "5" },
        { id: "p2", displayName: "Sam", hasVoted: false },
      ],
    };
    expect(decodeSnapshot(encodeSnapshot(snapshot))).toEqual(snapshot);
  });

  it("rejects hidden vote values during voting", () => {
    expect(() => decodeSnapshot({
      v: 1, r: "room-1", q: 2, s: "p1", p: 0,
      u: [["p1", "Alex", 1, "5"]],
    })).toThrow(/hidden vote/i);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the package does not exist yet**

Run: `corepack pnpm exec vitest run packages/protocol/test/wire.test.ts`

Expected: FAIL because `packages/protocol/src/index.ts` cannot be resolved.

- [ ] **Step 3: Add workspace configuration and install the protocol toolchain**

Create root scripts for `build`, `test`, `typecheck`, `lint:no-sockets`, `test:e2e`, and `test:load`. Set `packageManager` to `pnpm@10.15.0`, `engines.node` to `>=20 <21`, and add TypeScript, Vitest, ESLint, Prettier, `cross-env`, and `start-server-and-test` as root dev dependencies.

Run:

```bash
corepack pnpm install
corepack pnpm --filter @scrum-poker/protocol add zod
```

Use strict TypeScript settings with `module` and `moduleResolution` set to `NodeNext`, `noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`.

- [ ] **Step 4: Implement the exact shared contracts and compact codec**

```ts
export const VOTE_VALUES = ["0.5", "1", "2", "3", "5", "8", "13", "21", "?", "☕"] as const;
export type VoteValue = (typeof VOTE_VALUES)[number];
export type RoomPhase = "voting" | "revealed";
export interface ParticipantView {
  id: string;
  displayName: string;
  hasVoted: boolean;
  vote?: VoteValue;
}
export interface RoomSnapshot {
  roomId: string;
  revision: number;
  phase: RoomPhase;
  selfParticipantId: string;
  participants: ParticipantView[];
}
export interface CreatedRoomResponse {
  roomId: string;
  participantToken: string;
  facilitatorToken: string;
}
export interface JoinedRoomResponse { participantToken: string }
export interface StreamTicketResponse { ticket: string; expiresInSeconds: 30 }
export type WireParticipant = [id: string, name: string, voted: 0 | 1, vote?: VoteValue];
export interface WireSnapshot {
  v: 1;
  r: string;
  q: number;
  s: string;
  p: 0 | 1;
  u: WireParticipant[];
}
```

Define Zod schemas for `{ displayName }` and `{ value }`, trim names, enforce 1–30 characters, and reject values outside `VOTE_VALUES`. Export the three response interfaces shown above and the exact error-code union from the spec. `decodeSnapshot` must reject unsupported versions, malformed tuples, a vote value in phase `0`, or an invalid deck value.

- [ ] **Step 5: Run protocol tests, typecheck, and build**

Run:

```bash
corepack pnpm exec vitest run packages/protocol/test/wire.test.ts
corepack pnpm --filter @scrum-poker/protocol typecheck
corepack pnpm --filter @scrum-poker/protocol build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the protocol boundary**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts packages/protocol
git commit -m "feat: define scrum poker protocol"
```

### Task 2: Room State Machine and Credentials

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/auth/tokens.ts`
- Create: `apps/server/src/errors/api-error.ts`
- Create: `apps/server/src/rooms/room-store.ts`
- Test: `apps/server/test/room-store.test.ts`

**Interfaces:**
- Consumes: `VoteValue` and `RoomSnapshot` from `@scrum-poker/protocol`.
- Produces: `RoomStore`, `ApiError`, `generateToken(byteLength)`, `hashToken(token)`, and `safeTokenMatch(token, expectedHash)`.

- [ ] **Step 1: Write failing room behavior and secrecy tests**

```ts
it("keeps votes hidden until the creator reveals", () => {
  const created = store.createRoom("Alex");
  const joined = store.joinRoom(created.roomId, "Sam");
  store.castVote(created.roomId, joined.participantToken, "8");
  expect(store.snapshotFor(created.roomId, created.participantToken).participants[1]).toEqual({
    id: joined.participantId,
    displayName: "Sam",
    hasVoted: true,
  });
  store.reveal(created.roomId, created.participantToken, created.facilitatorToken);
  expect(store.snapshotFor(created.roomId, created.participantToken).participants[1]?.vote).toBe("8");
});

it("rejects reveal by a non-creator", () => {
  const created = store.createRoom("Alex");
  const joined = store.joinRoom(created.roomId, "Sam");
  expect(() => store.reveal(created.roomId, joined.participantToken, created.facilitatorToken))
    .toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
});
```

Add cases for case-insensitive names, 20 participants, changing votes before reveal, voting after reveal, reset from either phase, invalid tokens, revision increments, and one-hour expiry where reconnect activity does not update `lastActivityAt`.

- [ ] **Step 2: Run the tests and verify failure**

Run: `corepack pnpm exec vitest run apps/server/test/room-store.test.ts`

Expected: FAIL because `RoomStore` is missing.

- [ ] **Step 3: Implement secure token helpers and typed errors**

```ts
export function generateToken(byteLength: 16 | 32): string {
  return randomBytes(byteLength).toString("base64url");
}
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}
export function safeTokenMatch(token: string, expectedHash: Buffer): boolean {
  const actual = hashToken(token);
  return actual.length === expectedHash.length && timingSafeEqual(actual, expectedHash);
}
```

`ApiError` must carry an `ApiErrorCode`, HTTP status, and safe public message. Never attach raw tokens to errors.

- [ ] **Step 4: Implement `RoomStore` with an injectable clock**

```ts
export interface RoomStoreOptions {
  now?: () => number;
  maxRooms?: number;
  roomTtlMs?: number;
}
export interface CreatedRoom {
  roomId: string;
  participantId: string;
  participantToken: string;
  facilitatorToken: string;
}
export interface JoinedRoom {
  participantId: string;
  participantToken: string;
}
export class RoomStore {
  createRoom(displayName: string): CreatedRoom;
  joinRoom(roomId: string, displayName: string): JoinedRoom;
  authenticate(roomId: string, participantToken: string): string;
  castVote(roomId: string, participantToken: string, value: VoteValue): void;
  reveal(roomId: string, participantToken: string, facilitatorToken: string): void;
  reset(roomId: string, participantToken: string, facilitatorToken: string): void;
  snapshotFor(roomId: string, participantToken: string): RoomSnapshot;
  snapshotForParticipant(roomId: string, participantId: string): RoomSnapshot;
  sweepExpired(): string[];
}
```

Use a participant-token-hash index inside each room so authentication does not scan token strings. Use Unicode normalization plus `toLocaleLowerCase("en-US")` for the name uniqueness key. Mutations update activity and revision only after validation succeeds.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
corepack pnpm exec vitest run apps/server/test/room-store.test.ts
corepack pnpm --filter @scrum-poker/server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the domain model**

```bash
git add apps/server packages/protocol pnpm-lock.yaml
git commit -m "feat: add in-memory room state machine"
```

### Task 3: Stream Tickets and SSE Hub

**Files:**
- Create: `apps/server/src/streams/stream-tickets.ts`
- Create: `apps/server/src/streams/sse-hub.ts`
- Test: `apps/server/test/stream-tickets.test.ts`
- Test: `apps/server/test/sse-hub.test.ts`

**Interfaces:**
- Consumes: authenticated `participantId` from `RoomStore` and `encodeSnapshot` from the protocol package.
- Produces: `StreamTicketStore.issue(roomId, participantId)`, `consume(roomId, ticket)`, `SseHub.connect`, `publishRoom`, `closeRoom`, and `closeAll`.

- [ ] **Step 1: Add failing single-use ticket tests**

```ts
it("consumes a ticket exactly once within 30 seconds", () => {
  const tickets = new StreamTicketStore({ now: () => now });
  const ticket = tickets.issue("room-1", "p1");
  expect(tickets.consume("room-1", ticket)).toEqual({ participantId: "p1" });
  expect(() => tickets.consume("room-1", ticket)).toThrowError(
    expect.objectContaining({ code: "STREAM_TICKET_INVALID" }),
  );
});
```

Add a test advancing the fake clock past 30 seconds and expecting `STREAM_TICKET_EXPIRED`.

- [ ] **Step 2: Add failing SSE framing, heartbeat, and capacity tests**

Use a fake response sink that records `write()` calls. Assert the first write contains `event: snapshot`, all data is one encoded JSON line, heartbeat writes exactly `: ping\n\n`, the 101st connection receives `SERVICE_UNAVAILABLE`, and `closeRoom` emits `event: room-expired` before ending each sink.

- [ ] **Step 3: Run both files and verify failure**

Run: `corepack pnpm exec vitest run apps/server/test/stream-tickets.test.ts apps/server/test/sse-hub.test.ts`

Expected: FAIL because both classes are missing.

- [ ] **Step 4: Implement ticket expiry and the transport-neutral SSE sink**

```ts
export interface ConsumedTicket { participantId: string }
export class StreamTicketStore {
  issue(roomId: string, participantId: string): string;
  consume(roomId: string, ticket: string): ConsumedTicket;
  sweepExpired(): number;
}

export interface SseSink {
  write(chunk: string): boolean;
  end(): void;
  on(event: "close", listener: () => void): void;
}
export class SseHub {
  connect(roomId: string, participantId: string, sink: SseSink, initial: RoomSnapshot): () => void;
  publishRoom(roomId: string, snapshotFor: (participantId: string) => RoomSnapshot): void;
  closeRoom(roomId: string): void;
  closeAll(): void;
  heartbeat(): void;
}
```

Store no credential in the hub. Remove clients on `close`, make returned cleanup idempotent, and enforce the 100-client global ceiling before writing headers in the route layer.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
corepack pnpm exec vitest run apps/server/test/stream-tickets.test.ts apps/server/test/sse-hub.test.ts
corepack pnpm --filter @scrum-poker/server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the SSE primitives**

```bash
git add apps/server/src/streams apps/server/test
git commit -m "feat: add authenticated SSE primitives"
```

### Task 4: Express API, Rate Limits, and Lifecycle

**Files:**
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/rate-limit/sliding-window.ts`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/index.ts`
- Test: `apps/server/test/api.test.ts`
- Test: `apps/server/test/lifecycle.test.ts`

**Interfaces:**
- Consumes: `RoomStore`, `StreamTicketStore`, `SseHub`, request schemas, and `encodeSnapshot`.
- Produces: `createApp(dependencies): Express`, `startServer(config): Promise<RunningServer>`, `/api/rooms` routes, `/health/live`, and `/health/ready`.

- [ ] **Step 1: Write a failing create-to-reset API integration test**

```ts
const created = await request(app).post("/api/rooms").send({ displayName: "Alex" }).expect(201);
const joined = await request(app).post(`/api/rooms/${created.body.roomId}/join`)
  .send({ displayName: "Sam" }).expect(201);
await request(app).post(`/api/rooms/${created.body.roomId}/votes`)
  .set("Authorization", `Bearer ${joined.body.participantToken}`)
  .send({ value: "8" }).expect(204);
await request(app).post(`/api/rooms/${created.body.roomId}/reveal`)
  .set("Authorization", `Bearer ${created.body.participantToken}`)
  .set("X-Facilitator-Token", created.body.facilitatorToken)
  .expect(204);
await request(app).post(`/api/rooms/${created.body.roomId}/reset`)
  .set("Authorization", `Bearer ${created.body.participantToken}`)
  .set("X-Facilitator-Token", created.body.facilitatorToken)
  .expect(204);
```

Add integration cases for 4 KiB rejection, CORS allow/deny, invalid schemas, every stable domain error, ticket issue/consume, SSE headers and first snapshot, per-key rate limits, live/readiness health, and logs that never contain tokens or stream query strings.

- [ ] **Step 2: Run the API test and verify failure**

Run: `corepack pnpm exec vitest run apps/server/test/api.test.ts`

Expected: FAIL because `createApp` is missing.

- [ ] **Step 3: Implement validated configuration and rate-limit buckets**

```ts
const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: z.coerce.number().int().positive().default(4100),
  HOST: z.string().default("127.0.0.1"),
  CORS_ORIGINS: z.string().transform((value) => value.split(",").map((v) => v.trim())),
  EGRESS_DISABLED_FILE: z.string().default("/var/lib/scrum-poker/egress-disabled"),
});
```

Implement a one-minute sliding-window limiter keyed separately for room creation, joins by IP, joins by room, actions by participant, and tickets by participant with limits `10`, `30`, `40`, `120`, and `20` respectively. Trust exactly one proxy hop in production so Cloudflare/Nginx forwarding produces the client IP without trusting arbitrary headers directly.

- [ ] **Step 4: Implement the API and broadcasts**

Use `express.json({ limit: "4kb" })`, Helmet, explicit CORS origins, and a centralized `ApiError` handler. Authenticate before rate-limiting by participant where applicable. After every accepted mutation call:

```ts
hub.publishRoom(roomId, (participantId) => rooms.snapshotForParticipant(roomId, participantId));
```

The stream route consumes the short-lived ticket, sets `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, and `X-Accel-Buffering: no`, then connects the response to `SseHub`. Do not import a WebSocket library or inspect `Upgrade` headers.

- [ ] **Step 5: Implement timers and graceful shutdown**

`startServer` must schedule heartbeat every 30 seconds and room/ticket cleanup every five minutes. `SIGTERM` and `SIGINT` set readiness false, stop accepting new connections, close SSE clients, clear timers, close HTTP within 10 seconds, and exit nonzero only if forced.

- [ ] **Step 6: Run backend verification**

Run:

```bash
corepack pnpm exec vitest run apps/server/test/api.test.ts apps/server/test/lifecycle.test.ts
corepack pnpm --filter @scrum-poker/server typecheck
corepack pnpm --filter @scrum-poker/server build
```

Expected: PASS with no open-handle warning.

- [ ] **Step 7: Commit the working backend API**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat: expose scrum poker HTTP and SSE API"
```

### Task 5: Frontend API, Credentials, and Connection State

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/api/room-api.ts`
- Create: `apps/web/src/auth/room-credentials.ts`
- Create: `apps/web/src/room/room-reducer.ts`
- Create: `apps/web/src/room/use-room-connection.ts`
- Test: `apps/web/test/room-api.test.ts`
- Test: `apps/web/test/room-credentials.test.ts`
- Test: `apps/web/test/room-reducer.test.ts`
- Test: `apps/web/test/use-room-connection.test.tsx`

**Interfaces:**
- Consumes: protocol request/response types and compact decoder.
- Produces: `RoomApi`, `RoomCredentialStore`, `roomReducer`, and `useRoomConnection`.

- [ ] **Step 1: Write failing reducer and credential tests**

```ts
it("ignores an equal or older snapshot", () => {
  const current = { status: "connected" as const, snapshot: snapshotAt(5) };
  expect(roomReducer(current, { type: "snapshot", snapshot: snapshotAt(4) })).toBe(current);
  expect(roomReducer(current, { type: "snapshot", snapshot: snapshotAt(5) })).toBe(current);
});

it("stores facilitator credentials under one room only", () => {
  credentials.save("room-a", { participantToken: "participant", facilitatorToken: "facilitator" });
  expect(credentials.load("room-a")).toEqual({ participantToken: "participant", facilitatorToken: "facilitator" });
  expect(credentials.load("room-b")).toBeNull();
});
```

Use storage key `scrum-poker:v1:room:<roomId>` and reject malformed stored JSON rather than throwing.

- [ ] **Step 2: Write failing visibility and reconnect tests**

With fake timers and a fake `EventSource`, assert that the hook obtains a ticket, opens `/stream?ticket=...`, decodes snapshots, closes immediately when the document becomes hidden, obtains a fresh ticket when visible, retries after 1 second with full jitter controlled by an injected random function, caps delay at 30 seconds, and preserves the last snapshot while reconnecting.

- [ ] **Step 3: Run the focused frontend tests and verify failure**

Run: `corepack pnpm exec vitest run apps/web/test/room-*.test.ts apps/web/test/use-room-connection.test.tsx`

Expected: FAIL because the frontend modules are missing.

- [ ] **Step 4: Implement the typed HTTP boundary**

```ts
export interface RoomApi {
  createRoom(displayName: string): Promise<CreatedRoomResponse>;
  joinRoom(roomId: string, displayName: string): Promise<JoinedRoomResponse>;
  createStreamTicket(roomId: string, participantToken: string): Promise<string>;
  vote(roomId: string, participantToken: string, value: VoteValue): Promise<void>;
  reveal(roomId: string, participantToken: string, facilitatorToken: string): Promise<void>;
  reset(roomId: string, participantToken: string, facilitatorToken: string): Promise<void>;
}
export interface RoomCredentials {
  participantToken: string;
  facilitatorToken?: string;
}
export interface RoomCredentialStore {
  load(roomId: string): RoomCredentials | null;
  save(roomId: string, credentials: RoomCredentials): void;
  remove(roomId: string): void;
}
```

Use `VITE_API_BASE_URL`, omit credentials/cookies, set bearer and facilitator headers explicitly, parse stable API errors into `RoomApiError`, and apply a 10-second `AbortSignal.timeout` to non-stream requests.

- [ ] **Step 5: Implement storage, reducer, and `useRoomConnection`**

Expose `{ snapshot, status, lastError, reconnect }`, where status is `connecting | connected | reconnecting | offline | expired`. Create the stream URL from the short-lived ticket only; never append participant or facilitator tokens. Remove visibility listeners and close `EventSource` on unmount.

- [ ] **Step 6: Run frontend module tests and typecheck**

Run:

```bash
corepack pnpm exec vitest run apps/web/test/room-api.test.ts apps/web/test/room-credentials.test.ts apps/web/test/room-reducer.test.ts apps/web/test/use-room-connection.test.tsx
corepack pnpm --filter @scrum-poker/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the browser data layer**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat: add resilient browser room connection"
```

### Task 6: Friendly UI Foundation and Landing Flow

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/components.json`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app.tsx`
- Create: `apps/web/src/index.css`
- Create: `apps/web/src/pages/landing-page.tsx`
- Create: `apps/web/src/components/app-shell.tsx`
- Create: `apps/web/src/components/theme-toggle.tsx`
- Create: shadcn components under `apps/web/src/components/ui/`
- Test: `apps/web/test/landing-page.test.tsx`
- Test: `apps/web/test/app-routing.test.tsx`

**Interfaces:**
- Consumes: `RoomApi` and `RoomCredentialStore`.
- Produces: `App`, hash routes `/` and `/room/:roomId`, and the create/join landing flow.

- [ ] **Step 1: Write failing accessible landing-flow tests**

```tsx
it("creates a room and stores both creator credentials", async () => {
  render(<LandingPage api={api} credentials={credentials} navigate={navigate} />);
  await user.type(screen.getByLabelText(/display name/i), "Alex");
  await user.click(screen.getByRole("button", { name: /create room/i }));
  expect(credentials.save).toHaveBeenCalledWith("room-1", {
    participantToken: "pt",
    facilitatorToken: "ft",
  });
  expect(navigate).toHaveBeenCalledWith("/room/room-1");
});
```

Add join, trimmed-name validation, API error text, disabled pending controls, Enter-key submission, and hash-route restoration tests.

- [ ] **Step 2: Run the tests and verify failure**

Run: `corepack pnpm exec vitest run apps/web/test/landing-page.test.tsx apps/web/test/app-routing.test.tsx`

Expected: FAIL because the UI is missing.

- [ ] **Step 3: Install and initialize the selected community UI system**

Run:

```bash
corepack pnpm --filter @scrum-poker/web add react react-dom react-router-dom lucide-react next-themes
corepack pnpm --filter @scrum-poker/web add -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
corepack pnpm dlx shadcn@latest init --defaults
corepack pnpm dlx shadcn@latest add button input label card badge alert dialog tooltip skeleton sonner
```

Run the final two commands with `apps/web` as the working directory. Review generated files into source control. Do not add an animation library or charting package.

- [ ] **Step 4: Implement theme tokens and the app shell**

Define light/dark CSS variables for warm neutral surfaces, indigo primary actions, teal success, destructive errors, rounded cards, and visible `:focus-visible` rings. Add a skip link, semantic `main`, system theme default, reduced-motion media query, and a compact header with labeled theme toggle.

- [ ] **Step 5: Implement hash routing and the landing page**

```tsx
<HashRouter>
  <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/room/:roomId" element={<RoomPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
</HashRouter>
```

Use a single display-name field, separate “Create room” and “Join room” actions, a room-code field for joining, inline validation, and a toast only for transient system errors. Do not put credentials in navigation state or URLs.

- [ ] **Step 6: Run UI tests, typecheck, and a production build with Pages base**

Run:

```bash
corepack pnpm exec vitest run apps/web/test/landing-page.test.tsx apps/web/test/app-routing.test.tsx
corepack pnpm exec cross-env VITE_BASE_PATH=/scrum-poker/ VITE_API_BASE_URL=https://poker-api.keothom24.com pnpm --filter @scrum-poker/web build
corepack pnpm --filter @scrum-poker/web typecheck
```

Expected: PASS and `apps/web/dist/index.html` references `/scrum-poker/` assets.

- [ ] **Step 7: Commit the landing experience**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat: add accessible create and join experience"
```

### Task 7: Voting Room Interface

**Files:**
- Create: `apps/web/src/pages/room-page.tsx`
- Create: `apps/web/src/components/connection-status.tsx`
- Create: `apps/web/src/components/participant-list.tsx`
- Create: `apps/web/src/components/vote-deck.tsx`
- Create: `apps/web/src/components/facilitator-controls.tsx`
- Create: `apps/web/src/components/results-distribution.tsx`
- Create: `apps/web/src/components/share-room.tsx`
- Test: `apps/web/test/room-page.test.tsx`
- Test: `apps/web/test/vote-deck.test.tsx`
- Test: `apps/web/test/results-distribution.test.tsx`

**Interfaces:**
- Consumes: room credentials, `RoomApi`, `useRoomConnection`, `RoomSnapshot`, and `VOTE_VALUES`.
- Produces: complete voting, reveal, reset, participant-status, sharing, and results UI.

- [ ] **Step 1: Write failing hidden-vote and permission tests**

```tsx
it("shows vote status but not values before reveal", () => {
  renderRoom(votingSnapshot([{ name: "Sam", hasVoted: true }]));
  expect(screen.getByText("Sam")).toBeVisible();
  expect(screen.getByText(/voted/i)).toBeVisible();
  expect(screen.queryByText("8")).not.toBeInTheDocument();
});

it("does not render facilitator controls without the facilitator token", () => {
  renderRoom(votingSnapshot([]), { facilitatorToken: undefined });
  expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /reset/i })).not.toBeInTheDocument();
});
```

Add tests for all ten cards, selected state, changing selection, disabled voting after reveal, reveal/reset calls, copy-link output, `waiting` versus `voted`, connection text not relying on color, `?`/`☕` distributions, and no average.

- [ ] **Step 2: Run component tests and verify failure**

Run: `corepack pnpm exec vitest run apps/web/test/room-page.test.tsx apps/web/test/vote-deck.test.tsx apps/web/test/results-distribution.test.tsx`

Expected: FAIL because room components are missing.

- [ ] **Step 3: Implement focused room components**

`VoteDeck` renders one native button per `VOTE_VALUES` item with `aria-pressed`, a minimum 44×44 CSS-pixel hit area, visible focus, and a text-selected status. `ParticipantList` renders semantic list items and never accepts hidden vote data in voting phase. `ResultsDistribution` counts exact string values and renders CSS bars with textual counts, not a chart library.

- [ ] **Step 4: Implement room orchestration and failure behavior**

`RoomPage` loads credentials by room ID. Missing credentials shows a join-this-room form rather than opening an unauthenticated stream. Mutations disable only their relevant controls, display stable friendly errors, and rely on the next server snapshot for authoritative state. `ROOM_NOT_FOUND` or a `room-expired` event clears stored credentials and shows an expired-room action back to the landing page.

- [ ] **Step 5: Implement safe sharing**

Build the link as:

```ts
const shareUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
shareUrl.hash = `/room/${encodeURIComponent(roomId)}`;
```

Use `navigator.clipboard.writeText(shareUrl.toString())` with a visible fallback dialog. Assert the resulting link has no participant or facilitator token.

- [ ] **Step 6: Run component, accessibility, and build checks**

Run:

```bash
corepack pnpm exec vitest run apps/web/test
corepack pnpm --filter @scrum-poker/web typecheck
corepack pnpm exec cross-env VITE_BASE_PATH=/scrum-poker/ VITE_API_BASE_URL=https://poker-api.keothom24.com pnpm --filter @scrum-poker/web build
```

Expected: PASS.

- [ ] **Step 7: Commit the room interface**

```bash
git add apps/web
git commit -m "feat: add friendly scrum poker room UI"
```

### Task 8: End-to-End Journeys and No-Socket Enforcement

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/room-flow.spec.ts`
- Create: `e2e/reconnect.spec.ts`
- Create: `e2e/accessibility.spec.ts`
- Create: `scripts/assert-no-sockets.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: built server and web applications.
- Produces: reproducible multi-browser acceptance coverage and a repository-wide socket prohibition check.

- [ ] **Step 1: Add a failing no-socket guard**

```js
const forbiddenPackageNames = new Set(["socket.io", "socket.io-client", "ws"]);
const forbiddenSourcePatterns = [/new\s+WebSocket\s*\(/, /\/socket\.io\//, /proxy_set_header\s+Upgrade/i];
```

The script recursively inspects workspace `package.json` files plus source and `deploy/nginx` text files, excluding `node_modules`, `dist`, `.git`, plan/spec documentation, and the guard itself. It exits nonzero and prints the exact file/pattern on any match.

- [ ] **Step 2: Run the guard against a temporary forbidden fixture, then remove the fixture**

Create `apps/web/src/socket-fixture.ts` containing `new WebSocket("wss://example.invalid")`, run `corepack pnpm lint:no-sockets`, and expect FAIL naming the fixture. Delete only that fixture with `apply_patch`, rerun, and expect PASS.

- [ ] **Step 3: Write the multi-browser room journey**

```ts
test("creator and participant complete a private round", async ({ browser }) => {
  const creator = await browser.newContext();
  const participant = await browser.newContext();
  const creatorPage = await creator.newPage();
  const participantPage = await participant.newPage();
  // Create as Alex, copy the hash URL, join as Sam, vote 5 and 8,
  // assert values are absent before reveal, reveal as Alex, then reset.
});
```

Assert a participant cannot produce reveal/reset requests through the UI, creator refresh retains controls, a second browser does not inherit creator authority, and network logs contain EventSource plus HTTP requests but no `websocket` resource.

- [ ] **Step 4: Add reconnect and accessibility journeys**

Use Playwright to change visibility where supported and direct unit coverage for browser visibility otherwise. Restart only the test server to assert temporary-room loss messaging. Use `@axe-core/playwright` on landing, voting, and revealed screens and fail on serious or critical violations.

- [ ] **Step 5: Run the full local acceptance suite**

Run:

```bash
corepack pnpm lint:no-sockets
corepack pnpm test
corepack pnpm build
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
```

Expected: all commands exit 0; Playwright reports no WebSocket requests.

- [ ] **Step 6: Commit acceptance coverage**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts e2e scripts
git commit -m "test: cover scrum poker browser journeys"
```

### Task 9: Shared-VM Load and Memory Gate

**Files:**
- Create: `load/sse-load.ts`
- Create: `load/sse-load.test.ts`
- Create: `load/README.md`
- Modify: `apps/server/package.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: public HTTP/SSE API.
- Produces: `pnpm test:load -- --base-url=<url>` result with connection count, disconnects, bytes, duration, and process-independent pass/fail criteria.

- [ ] **Step 1: Write the load runner's failing argument and result tests**

Extract pure `parseLoadOptions(argv)` and `evaluateLoadResult(result)` functions. Test defaults of five rooms, 20 participants each, five minutes, zero allowed unexpected disconnects, and `220 MiB` documented RSS ceiling. The load runner must require an explicit base URL and never default to production.

- [ ] **Step 2: Run the load unit test and verify failure**

Run: `corepack pnpm exec vitest run load/sse-load.test.ts`

Expected: FAIL because the parser is missing.

- [ ] **Step 3: Implement the 100-client runner**

Use the same HTTP endpoints as the browser: create five rooms, join 19 additional participants to each, issue one ticket per participant, and open 100 SSE streams. Count received bytes, require all initial snapshots, cast representative votes, reveal and reset each room, maintain streams for the configured duration, then close cleanly. Never log bearer, facilitator, or ticket values.

- [ ] **Step 4: Run a 30-second local load check**

Run:

```bash
corepack pnpm exec start-server-and-test "pnpm --filter @scrum-poker/server start:test" http://127.0.0.1:4100/health/ready "pnpm test:load -- --base-url=http://127.0.0.1:4100 --duration-seconds=30"
```

Expected: 100 connected, 0 unexpected disconnects, all five rooms complete vote/reveal/reset.

- [ ] **Step 5: Document the production memory observation**

`load/README.md` must require `pm2 monit` or `pm2 jlist` during the five-minute run and reject deployment if `scrum-poker-backend` exceeds 220 MiB RSS, any existing process restarts, or available VM memory falls below 100 MiB during the test.

- [ ] **Step 6: Commit the capacity gate**

```bash
git add load package.json apps/server/package.json pnpm-lock.yaml
git commit -m "test: add shared VM SSE capacity gate"
```

### Task 10: GitHub Pages Deployment

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `apps/web/vite.config.ts`
- Test: `apps/web/test/pages-build.test.ts`

**Interfaces:**
- Consumes: the static Vite app and `poker-api.keothom24.com` API.
- Produces: GitHub Pages artifact rooted at `/scrum-poker/` with valid hash routes.

- [ ] **Step 1: Write a failing Pages artifact test**

Build with `VITE_BASE_PATH=/scrum-poker/` and inspect `dist/index.html`. Assert scripts/styles begin with `/scrum-poker/`, no filesystem path leaks into HTML, and a simulated `https://owner.github.io/scrum-poker/#/room/abc` resolves room ID `abc` in the router test.

- [ ] **Step 2: Run the test and verify failure before workflow/config support**

Run: `corepack pnpm exec vitest run apps/web/test/pages-build.test.ts`

Expected: FAIL because the base-path contract is not implemented.

- [ ] **Step 3: Make Vite base explicit and validated**

```ts
const base = process.env.VITE_BASE_PATH ?? "/";
if (!base.startsWith("/") || !base.endsWith("/")) {
  throw new Error("VITE_BASE_PATH must start and end with /");
}
export default defineConfig({ base, plugins: [react(), tailwindcss()] });
```

- [ ] **Step 4: Add the GitHub Pages workflow**

The workflow triggers on pushes to `main` and manual dispatch, uses Node 20 and Corepack, runs `pnpm install --frozen-lockfile`, `pnpm lint:no-sockets`, `pnpm test`, and `pnpm build`, then uploads `apps/web/dist` with `actions/upload-pages-artifact` and deploys with `actions/deploy-pages`. Set:

```yaml
env:
  VITE_BASE_PATH: /scrum-poker/
  VITE_API_BASE_URL: https://poker-api.keothom24.com
```

Grant only `contents: read`, `pages: write`, and `id-token: write`; use the `github-pages` environment and a single cancel-in-progress deployment concurrency group.

- [ ] **Step 5: Re-run the complete static deployment check**

Run:

```bash
corepack pnpm exec cross-env VITE_BASE_PATH=/scrum-poker/ VITE_API_BASE_URL=https://poker-api.keothom24.com pnpm build
corepack pnpm exec vitest run apps/web/test/pages-build.test.ts
corepack pnpm lint:no-sockets
```

Expected: PASS.

- [ ] **Step 6: Commit Pages deployment**

```bash
git add .github apps/web/vite.config.ts apps/web/test/pages-build.test.ts
git commit -m "ci: deploy frontend to GitHub Pages"
```

### Task 11: Isolated PM2, Nginx, and Deploy Script

**Files:**
- Create: `apps/server/.env.example`
- Create: `deploy/ecosystem.config.cjs`
- Create: `deploy/nginx/scrum-poker-http.conf`
- Create: `deploy/nginx/scrum-poker.conf`
- Create: `deploy/deploy.sh`
- Create: `deploy/test/deploy-static.test.mjs`

**Interfaces:**
- Consumes: compiled backend at `/opt/scrum-poker/apps/server/dist/index.js` and existing Node 20/PM2/Nginx/Certbot.
- Produces: isolated `scrum-poker-backend` process, port 4100, TLS API hostname, and safe repeatable deployment.

- [ ] **Step 1: Write failing static isolation tests**

```ts
it("never targets KeoThom resources", async () => {
  const script = await readFile("deploy/deploy.sh", "utf8");
  expect(script).not.toMatch(/pm2\s+(?:restart|stop|delete)\s+keothom-/);
  expect(script).not.toMatch(/sites-available\/keothom/);
  expect(script).not.toMatch(/\/opt\/keothom|\/var\/lib\/keothom/);
});

it("contains no websocket proxy configuration", async () => {
  const nginx = await readFile("deploy/nginx/scrum-poker.conf", "utf8");
  expect(nginx).not.toMatch(/Upgrade|socket\.io|Connection\s+['"]?upgrade/i);
});
```

Also assert exact app name, port, directories, hostname, `proxy_buffering off`, `proxy_cache off`, `gzip off`, 75-second read timeout, and `nginx -t` before reload.

- [ ] **Step 2: Run the deployment tests and verify failure**

Run: `corepack pnpm exec vitest run deploy/test/deploy-static.test.mjs`

Expected: FAIL because deployment files are missing.

- [ ] **Step 3: Add the isolated PM2 configuration**

```js
module.exports = {
  apps: [{
    name: "scrum-poker-backend",
    cwd: "/opt/scrum-poker/apps/server",
    script: "dist/index.js",
    instances: 1,
    exec_mode: "fork",
    max_memory_restart: "256M",
    kill_timeout: 10000,
    env_production: {
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: 4100,
      EGRESS_DISABLED_FILE: "/var/lib/scrum-poker/egress-disabled",
    },
  }],
};
```

Keep `CORS_ORIGINS=https://<github-owner>.github.io` in `/opt/scrum-poker/apps/server/.env`, not source-controlled. Startup must fail in production if it is absent.

- [ ] **Step 4: Add HTTP bootstrap and production Nginx sites**

The bootstrap site serves `/.well-known/acme-challenge/` from `/var/www/letsencrypt` and proxies nothing. The production site uses the dedicated certificate and proxies API traffic to `127.0.0.1:4100`. The SSE location is exact-match-compatible with `/api/rooms/<id>/stream`, passes HTTP/1.1 with `Connection ""`, and disables buffering/cache/gzip. Add a JSON 503 maintenance response when `/var/lib/scrum-poker/egress-disabled` exists. Do not add any `Upgrade` header.

Use this production shape for both the general API location and the more-specific SSE location:

```nginx
upstream scrum_poker_backend {
  server 127.0.0.1:4100;
  keepalive 16;
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name poker-api.keothom24.com;
  ssl_certificate /etc/letsencrypt/live/poker-api.keothom24.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/poker-api.keothom24.com/privkey.pem;

  error_page 503 = @scrum_poker_maintenance;

  location ~ ^/api/rooms/[^/]+/stream$ {
    if (-f /var/lib/scrum-poker/egress-disabled) { return 503; }
    proxy_pass http://scrum_poker_backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $http_cf_connecting_ip;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 75s;
  }

  location / {
    if (-f /var/lib/scrum-poker/egress-disabled) { return 503; }
    proxy_pass http://scrum_poker_backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $http_cf_connecting_ip;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location @scrum_poker_maintenance {
    default_type application/json;
    return 503 '{"code":"SERVICE_UNAVAILABLE","message":"Scrum Poker is temporarily unavailable."}';
  }
}
```

- [ ] **Step 5: Implement a non-invasive deploy script**

The script must:

1. Require Ubuntu/Debian, Node major 20, PM2, Nginx, Certbot, Corepack, Git, `vnstat`, and `jq`; report missing prerequisites without installing or upgrading them.
2. Require at least 300 MiB available memory and 1 GiB free disk.
3. Verify port 4100 is free unless PM2 already owns `scrum-poker-backend`.
4. Run `corepack pnpm install --frozen-lockfile`, tests, no-socket guard, and build in `/opt/scrum-poker`.
5. Install only the Scrum Poker bootstrap Nginx site if its dedicated certificate is missing, validate, reload, and run `certbot certonly --webroot -w /var/www/letsencrypt -d poker-api.keothom24.com`.
6. Install the production Scrum Poker Nginx site, run `nginx -t`, then reload.
7. Start or restart only `scrum-poker-backend`, update its environment, and run `pm2 save`.
8. Verify `keothom-backend` and `keothom-frontend` remain online with unchanged restart counters captured before deployment.

Anchor every mutation to Scrum Poker constants and never accept a caller-supplied PM2 name or Nginx destination:

```bash
readonly APP_DIR="/opt/scrum-poker"
readonly APP_NAME="scrum-poker-backend"
readonly BACKEND_PORT="4100"
readonly NGINX_SITE="scrum-poker"

sudo nginx -t
sudo systemctl reload nginx
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start "$APP_DIR/deploy/ecosystem.config.cjs" --only "$APP_NAME" --env production
fi
pm2 save
```

- [ ] **Step 6: Validate syntax and isolation**

Run:

```bash
bash -n deploy/deploy.sh
node --check deploy/ecosystem.config.cjs
corepack pnpm exec vitest run deploy/test/deploy-static.test.mjs
corepack pnpm lint:no-sockets
```

Expected: PASS. The static test must prove no destructive or restart command targets KeoThom.

- [ ] **Step 7: Commit isolated deployment assets**

```bash
git add apps/server/.env.example deploy
git commit -m "ops: isolate scrum poker on shared VM"
```

### Task 12: Egress Guard, Smoke Test, and Operations Runbook

**Files:**
- Create: `deploy/scripts/egress-guard.sh`
- Create: `deploy/scripts/smoke-sse.mjs`
- Create: `deploy/systemd/scrum-poker-egress-guard.service`
- Create: `deploy/systemd/scrum-poker-egress-guard.timer`
- Create: `deploy/test/egress-guard.test.sh`
- Create: `docs/operations.md`

**Interfaces:**
- Consumes: `vnstat` JSON, PM2 process name, the maintenance flag, and production API.
- Produces: five-minute guard timer, dry-run verification, five-minute SSE smoke probe, deployment/rollback instructions, and monitoring checklist.

- [ ] **Step 1: Write failing egress-guard fixture tests**

Provide fixed `vnstat` JSON fixtures below and above `900000000` transmitted bytes. Inject `VNSTAT_COMMAND`, `PM2_COMMAND`, `FLAG_FILE`, and `DRY_RUN=true`. Assert below-threshold does nothing; above-threshold reports it would stop only `scrum-poker-backend` and create only the Scrum Poker flag; malformed JSON fails closed with a nonzero exit without stopping any process.

- [ ] **Step 2: Run the guard tests and verify failure**

Run: `bash deploy/test/egress-guard.test.sh`

Expected: FAIL because the guard is missing.

- [ ] **Step 3: Implement the shared-interface guard**

```bash
THRESHOLD_BYTES="${THRESHOLD_BYTES:-900000000}"
APP_NAME="scrum-poker-backend"
tx_bytes="$(${VNSTAT_COMMAND:-vnstat} --json m 1 | jq -er '.interfaces[0].traffic.month | max_by(.date.year * 12 + .date.month) | .tx')"
if (( tx_bytes >= THRESHOLD_BYTES )); then
  if [[ "${DRY_RUN:-false}" == "true" ]]; then
    printf 'would stop %s at %s bytes\n' "$APP_NAME" "$tx_bytes"
    exit 0
  fi
  install -m 0644 /dev/null "${FLAG_FILE:-/var/lib/scrum-poker/egress-disabled}"
  "${PM2_COMMAND:-pm2}" stop "$APP_NAME"
fi
```

Resolve the actual VM network interface during installation and initialize `vnstat` before enabling the timer. Never call `pm2 stop all`, stop a KeoThom process, or edit its Nginx configuration.

- [ ] **Step 4: Add the systemd timer and production SSE smoke script**

The timer runs the guard every five minutes as root. `smoke-sse.mjs` creates a uniquely named room, obtains a ticket, opens native HTTP SSE for five minutes, confirms at least nine 30-second heartbeats, casts one vote, confirms the next revision, and exits without logging credentials. It accepts `--base-url` and refuses a non-HTTPS production URL unless `--allow-http` is explicit.

- [ ] **Step 5: Write the complete operations runbook**

Document:

- GitHub Pages setup with source “GitHub Actions,” URL shape `https://<github-owner>.github.io/scrum-poker/`, hash-route links, and the exact CORS origin `https://<github-owner>.github.io`.
- Cloudflare DNS for proxied `poker-api.keothom24.com` pointing to the existing VM.
- One-time prerequisite commands for `vnstat` and `jq`, without reinstalling Node/Nginx/PM2.
- Predeploy capture: `free -m`, `df -h`, `ss -ltnp`, `pm2 list`, and KeoThom restart counters.
- Deploy, TLS bootstrap, `nginx -t`, health checks, five-minute SSE smoke, and 100-client load gate.
- Rollback by restoring only the prior Scrum Poker checkout/config and restarting only `scrum-poker-backend`.
- Room loss on restart, logs with token redaction, PM2 memory/restart monitoring, `vnstat` inspection, and GCP budget notifications at 50%, 80%, and 90% of US$1.
- The explicit warning that the 900 MB guard observes shared VM traffic and cannot cap continued KeoThom egress.
- Month-boundary recovery: verify the new month's `vnstat` counter, remove only `/var/lib/scrum-poker/egress-disabled`, and start only `scrum-poker-backend`; never clear the flag automatically.

- [ ] **Step 6: Run final local verification**

Run:

```bash
bash -n deploy/scripts/egress-guard.sh
bash deploy/test/egress-guard.test.sh
node --check deploy/scripts/smoke-sse.mjs
corepack pnpm lint:no-sockets
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:e2e
```

Expected: every command exits 0.

- [ ] **Step 7: Commit operations and guardrails**

```bash
git add deploy docs/operations.md
git commit -m "ops: add egress guard and production runbook"
```

### Task 13: Final Cross-System Verification

**Files:**
- Modify only files required to correct failures discovered by the commands below.

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: evidence that the approved acceptance criteria and shared-VM isolation hold together.

- [ ] **Step 1: Verify the repository and dependency graph contain no socket transport**

Run:

```bash
corepack pnpm lint:no-sockets
corepack pnpm list --recursive --depth Infinity
```

Expected: the guard passes and the dependency output contains no `socket.io`, `socket.io-client`, or application WebSocket transport. If a development tool has a transitive `ws`, update the guard to distinguish tool-only transitive packages from application/runtime dependencies and document the evidence; do not weaken source or deployment checks.

- [ ] **Step 2: Run all local quality gates from a clean checkout**

Run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:e2e
bash -n deploy/deploy.sh
bash deploy/test/egress-guard.test.sh
```

Expected: all commands exit 0 with no open handles, leaked secrets, or accessibility violations.

- [ ] **Step 3: Perform the shared-VM preflight without changing services**

Run on the VM:

```bash
free -m
df -h /opt /var
ss -ltnp
pm2 list
pm2 jlist
sudo nginx -t
vnstat --json m 1
```

Expected: at least 300 MiB memory available, at least 1 GiB disk free, port 4100 unused by unrelated software, both KeoThom processes online, valid Nginx configuration, and monthly transmitted bytes below 900000000. Stop before deployment if any expectation fails.

- [ ] **Step 4: Deploy and verify isolation**

Run the approved deploy script, then compare KeoThom PM2 status and restart counters with the preflight snapshot. Verify only `scrum-poker-backend` was added/restarted, `curl https://keothom24.com/api/health` still succeeds, and `curl https://poker-api.keothom24.com/health/ready` succeeds.

- [ ] **Step 5: Verify production SSE, Pages, and capacity**

Run:

```bash
node deploy/scripts/smoke-sse.mjs --base-url=https://poker-api.keothom24.com
corepack pnpm test:load -- --base-url=https://poker-api.keothom24.com --duration-seconds=300
```

Open the deployed GitHub Pages URL, create and share a hash-route room, join from a second browser, complete vote/reveal/reset, hide and restore one tab, and confirm browser developer tools show `EventSource` plus HTTP only. Confirm Scrum Poker RSS stays below 220 MiB and neither KeoThom process restarts.

- [ ] **Step 6: Exercise the guard in dry-run mode**

Run the egress guard with `DRY_RUN=true` and a fixture threshold below current usage. Confirm it names only `scrum-poker-backend`, leaves all PM2 processes untouched, and does not create the production flag.

- [ ] **Step 7: Record final evidence and commit any verification-only corrections**

Add the tested deployment date, Pages URL, API hostname, observed peak Scrum Poker RSS, SSE/load results, KeoThom before/after restart counters, and current egress reading to the operations deployment log section. If corrections were necessary, commit them with:

```bash
git add -A
git commit -m "chore: finalize scrum poker deployment verification"
```
