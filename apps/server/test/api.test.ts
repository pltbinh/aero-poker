import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { encodeSnapshot } from "@scrum-poker/protocol";
import { ApiError } from "../src/errors/api-error.js";
import { RoomStore } from "../src/rooms/room-store.js";
import { StreamTicketStore } from "../src/streams/stream-tickets.js";
import { SseHub } from "../src/streams/sse-hub.js";
import { createApp } from "../src/app.js";

interface Clock {
  now: () => number;
  advanceBy: (ms: number) => void;
}

interface TestLogger {
  lines: string[];
  info: (message: string) => void;
  error: (message: string) => void;
}

interface TestContext {
  app: ReturnType<typeof createApp>;
  baseUrl: string;
  clock: Clock;
  logger: TestLogger;
  rooms: RoomStore;
  tickets: StreamTicketStore;
  close: () => Promise<void>;
}

interface CreateTestContextOptions {
  nodeEnv?: "development" | "test" | "production";
  ready?: boolean;
  rooms?: RoomStore;
}

function createClock(start = 0): Clock {
  let current = start;

  return {
    now: () => current,
    advanceBy: (ms: number) => {
      current += ms;
    },
  };
}

function createLogger(): TestLogger {
  const lines: string[] = [];

  return {
    lines,
    info: (message: string) => {
      lines.push(message);
    },
    error: (message: string) => {
      lines.push(message);
    },
  };
}

async function createTestContext(options: CreateTestContextOptions = {}): Promise<TestContext> {
  const clock = createClock();
  const logger = createLogger();
  const rooms = options.rooms ?? new RoomStore({ now: clock.now });
  const tickets = new StreamTicketStore({ now: clock.now });
  const hub = new SseHub();
  const app = createApp({
    config: {
      nodeEnv: options.nodeEnv ?? "test",
      host: "127.0.0.1",
      port: 0,
      corsOrigins: ["https://allowed.example"],
      egressDisabledFile: "D:/Projects/scrum-poker/.tmp/egress-disabled",
    },
    logger,
    now: clock.now,
    readiness: {
      isReady: () => options.ready ?? true,
    },
    rooms,
    tickets,
    hub,
  });
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an IPv4 address");
  }

  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    clock,
    logger,
    rooms,
    tickets,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function requestJson(
  baseUrl: string,
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<{ response: Response; body: unknown }> {
  const headers = new Headers(init.headers);
  let body = init.body;

  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    body,
    headers,
  });
  const text = await response.text();

  return {
    response,
    body: text === "" ? undefined : JSON.parse(text),
  };
}

async function openStream(baseUrl: string, roomId: string, ticket: string): Promise<{ response: Response; chunk: string }> {
  const response = await fetch(`${baseUrl}/api/rooms/${roomId}/stream?ticket=${ticket}`);

  if (response.body === null) {
    throw new Error("Expected a response body");
  }

  const reader = response.body.getReader();
  const first = await reader.read();
  await reader.cancel();

  return {
    response,
    chunk: new TextDecoder().decode(first.value ?? new Uint8Array()),
  };
}

async function connectStream(
  baseUrl: string,
  roomId: string,
  ticket: string,
): Promise<{
  response: Response;
  readChunk: () => Promise<string>;
  close: () => Promise<void>;
}> {
  const response = await fetch(`${baseUrl}/api/rooms/${roomId}/stream?ticket=${ticket}`);

  if (response.body === null) {
    throw new Error("Expected a response body");
  }

  const reader = response.body.getReader();

  return {
    response,
    readChunk: async () => {
      const frame = await reader.read();
      return new TextDecoder().decode(frame.value ?? new Uint8Array());
    },
    close: async () => {
      await reader.cancel();
    },
  };
}

const openContexts = new Set<TestContext>();

afterEach(async () => {
  for (const context of openContexts) {
    await context.close();
    openContexts.delete(context);
  }
});

describe("createApp", () => {
  it("creates, joins, votes, reveals, resets, and returns revisioned snapshots", async () => {
    const context = await createTestContext();
    openContexts.add(context);

    const created = await requestJson(context.baseUrl, "/api/rooms", {
      method: "POST",
      json: { displayName: "Alex" },
    });

    expect(created.response.status).toBe(201);
    expect(created.body).toEqual({
      roomId: expect.any(String),
      participantToken: expect.any(String),
      facilitatorToken: expect.any(String),
    });

    const creator = created.body as { roomId: string; participantToken: string; facilitatorToken: string };
    const initial = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}`, {
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
      },
    });

    expect(initial.response.status).toBe(200);
    expect(initial.body).toEqual(
      encodeSnapshot({
        roomId: creator.roomId,
        revision: 0,
        phase: "voting",
        selfParticipantId: expect.any(String),
        participants: [
          {
            id: expect.any(String),
            displayName: "Alex",
            hasVoted: false,
          },
        ],
      } as never),
    );

    const joined = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}/join`, {
      method: "POST",
      json: { displayName: "Sam" },
    });

    expect(joined.response.status).toBe(201);
    expect(joined.body).toEqual({
      participantToken: expect.any(String),
    });

    const participantToken = (joined.body as { participantToken: string }).participantToken;

    const voted = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}/votes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${participantToken}`,
      },
      json: { value: "8" },
    });

    expect(voted.response.status).toBe(204);

    const duringVoting = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}`, {
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
      },
    });

    expect(duringVoting.body).toEqual({
      v: 1,
      r: creator.roomId,
      q: 2,
      s: expect.any(String),
      p: 0,
      u: [
        [expect.any(String), "Alex", 0],
        [expect.any(String), "Sam", 1],
      ],
    });

    const revealed = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}/reveal`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
        "X-Facilitator-Token": creator.facilitatorToken,
      },
    });

    expect(revealed.response.status).toBe(204);

    const afterReveal = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}`, {
      headers: {
        Authorization: `Bearer ${participantToken}`,
      },
    });

    expect(afterReveal.body).toEqual({
      v: 1,
      r: creator.roomId,
      q: 3,
      s: expect.any(String),
      p: 1,
      u: [
        [expect.any(String), "Alex", 0],
        [expect.any(String), "Sam", 1, "8"],
      ],
    });

    const reset = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}/reset`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
        "X-Facilitator-Token": creator.facilitatorToken,
      },
    });

    expect(reset.response.status).toBe(204);

    const afterReset = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}`, {
      headers: {
        Authorization: `Bearer ${participantToken}`,
      },
    });

    expect(afterReset.body).toEqual({
      v: 1,
      r: creator.roomId,
      q: 4,
      s: expect.any(String),
      p: 0,
      u: [
        [expect.any(String), "Alex", 0],
        [expect.any(String), "Sam", 0],
      ],
    });
  });

  it("rejects oversized bodies and invalid schemas", async () => {
    const context = await createTestContext();
    openContexts.add(context);

    const oversized = await requestJson(context.baseUrl, "/api/rooms", {
      method: "POST",
      json: { displayName: "x".repeat(5000) },
    });

    expect(oversized.response.status).toBe(413);
    expect(oversized.body).toEqual({
      code: "INVALID_REQUEST",
      message: expect.any(String),
    });

    const invalidCreate = await requestJson(context.baseUrl, "/api/rooms", {
      method: "POST",
      json: { displayName: "" },
    });

    expect(invalidCreate.response.status).toBe(400);
    expect(invalidCreate.body).toEqual({
      code: "INVALID_REQUEST",
      message: expect.any(String),
    });

    const created = await requestJson(context.baseUrl, "/api/rooms", {
      method: "POST",
      json: { displayName: "Alex" },
    });
    const creator = created.body as { roomId: string; participantToken: string };
    const invalidVote = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}/votes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
      },
      json: {},
    });

    expect(invalidVote.response.status).toBe(400);
    expect(invalidVote.body).toEqual({
      code: "INVALID_REQUEST",
      message: expect.any(String),
    });
  });

  it("allows configured CORS origins and omits headers for denied origins", async () => {
    const context = await createTestContext();
    openContexts.add(context);

    const allowed = await fetch(`${context.baseUrl}/health/live`, {
      headers: {
        Origin: "https://allowed.example",
      },
    });

    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
    expect(allowed.headers.get("vary")).toContain("Origin");

    const denied = await fetch(`${context.baseUrl}/health/live`, {
      headers: {
        Origin: "https://denied.example",
      },
    });

    expect(denied.status).toBe(200);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const preflight = await fetch(`${context.baseUrl}/api/rooms`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://allowed.example",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
  });

  it("surfaces stable domain errors without leaking credentials", async () => {
    class InvalidVoteRoomStore extends RoomStore {
      override castVote(): void {
        throw new ApiError("INVALID_VOTE", 400, "Vote value is not in the shared deck.");
      }
    }

    const roomMissingContext = await createTestContext();
    openContexts.add(roomMissingContext);

    const missingRoom = await requestJson(roomMissingContext.baseUrl, "/api/rooms/not-a-room/join", {
      method: "POST",
      json: { displayName: "Sam" },
    });
    expect(missingRoom.response.status).toBe(404);
    expect(missingRoom.body).toEqual({
      code: "ROOM_NOT_FOUND",
      message: "Room not-a-room was not found.",
    });

    const namesContext = await createTestContext();
    openContexts.add(namesContext);

    const created = await requestJson(namesContext.baseUrl, "/api/rooms", {
      method: "POST",
      json: { displayName: "Élodie" },
    });
    const creator = created.body as { roomId: string; participantToken: string; facilitatorToken: string };

    const nameTaken = await requestJson(namesContext.baseUrl, `/api/rooms/${creator.roomId}/join`, {
      method: "POST",
      json: { displayName: "e\u0301lodie" },
    });
    expect(nameTaken.response.status).toBe(409);
    expect(nameTaken.body).toEqual({
      code: "NAME_TAKEN",
      message: "That display name is already in use.",
    });

    const invalidToken = await requestJson(namesContext.baseUrl, `/api/rooms/${creator.roomId}`, {
      headers: {
        Authorization: "Bearer not-a-token",
      },
    });
    expect(invalidToken.response.status).toBe(401);
    expect(invalidToken.body).toEqual({
      code: "INVALID_TOKEN",
      message: "Participant credentials are invalid.",
    });

    const joined = await requestJson(namesContext.baseUrl, `/api/rooms/${creator.roomId}/join`, {
      method: "POST",
      json: { displayName: "Sam" },
    });
    const joinerToken = (joined.body as { participantToken: string }).participantToken;
    const forbidden = await requestJson(namesContext.baseUrl, `/api/rooms/${creator.roomId}/reveal`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${joinerToken}`,
        "X-Facilitator-Token": creator.facilitatorToken,
      },
    });
    expect(forbidden.response.status).toBe(403);
    expect(forbidden.body).toEqual({
      code: "FORBIDDEN",
      message: "Only the room creator can reveal votes.",
    });

    await requestJson(namesContext.baseUrl, `/api/rooms/${creator.roomId}/reveal`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
        "X-Facilitator-Token": creator.facilitatorToken,
      },
    });

    const revealedVote = await requestJson(namesContext.baseUrl, `/api/rooms/${creator.roomId}/votes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${joinerToken}`,
      },
      json: { value: "3" },
    });
    expect(revealedVote.response.status).toBe(409);
    expect(revealedVote.body).toEqual({
      code: "VOTING_REVEALED",
      message: "Votes cannot change after reveal.",
    });

    const alreadyRevealed = await requestJson(namesContext.baseUrl, `/api/rooms/${creator.roomId}/reveal`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
        "X-Facilitator-Token": creator.facilitatorToken,
      },
    });
    expect(alreadyRevealed.response.status).toBe(409);
    expect(alreadyRevealed.body).toEqual({
      code: "ALREADY_REVEALED",
      message: "Votes are already revealed.",
    });

    const ticketResponse = await requestJson(namesContext.baseUrl, `/api/rooms/${creator.roomId}/stream-ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
      },
    });
    const ticket = (ticketResponse.body as { ticket: string }).ticket;
    await openStream(namesContext.baseUrl, creator.roomId, ticket);

    const consumedTicket = await requestJson(namesContext.baseUrl, `/api/rooms/${creator.roomId}/stream?ticket=${ticket}`);
    expect(consumedTicket.response.status).toBe(401);
    expect(consumedTicket.body).toEqual({
      code: "STREAM_TICKET_INVALID",
      message: "The stream ticket is invalid.",
    });

    const expiringTicket = await requestJson(namesContext.baseUrl, `/api/rooms/${creator.roomId}/stream-ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
      },
    });
    namesContext.clock.advanceBy(30_001);

    const expiredTicket = await requestJson(
      namesContext.baseUrl,
      `/api/rooms/${creator.roomId}/stream?ticket=${(expiringTicket.body as { ticket: string }).ticket}`,
    );
    expect(expiredTicket.response.status).toBe(401);
    expect(expiredTicket.body).toEqual({
      code: "STREAM_TICKET_EXPIRED",
      message: "The stream ticket has expired.",
    });

    const rateLimitContext = await createTestContext({ nodeEnv: "production" });
    openContexts.add(rateLimitContext);

    for (let index = 0; index < 10; index += 1) {
      const response = await requestJson(rateLimitContext.baseUrl, "/api/rooms", {
        method: "POST",
        headers: {
          "X-Forwarded-For": "203.0.113.10",
        },
        json: { displayName: `Host ${index}` },
      });

      expect(response.response.status).toBe(201);
    }

    const rateLimited = await requestJson(rateLimitContext.baseUrl, "/api/rooms", {
      method: "POST",
      headers: {
        "X-Forwarded-For": "203.0.113.10",
      },
      json: { displayName: "Overflow" },
    });
    expect(rateLimited.response.status).toBe(429);
    expect(rateLimited.body).toEqual({
      code: "RATE_LIMITED",
      message: expect.any(String),
    });

    const unavailableContext = await createTestContext({
      rooms: new RoomStore({ maxRooms: 0 }),
    });
    openContexts.add(unavailableContext);

    const unavailable = await requestJson(unavailableContext.baseUrl, "/api/rooms", {
      method: "POST",
      json: { displayName: "Alex" },
    });
    expect(unavailable.response.status).toBe(503);
    expect(unavailable.body).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "The room service is at capacity.",
    });

    const invalidVoteContext = await createTestContext({
      rooms: new InvalidVoteRoomStore(),
    });
    openContexts.add(invalidVoteContext);

    const createdForInvalidVote = await requestJson(invalidVoteContext.baseUrl, "/api/rooms", {
      method: "POST",
      json: { displayName: "Alex" },
    });
    const invalidVoteRoom = createdForInvalidVote.body as { roomId: string; participantToken: string };
    const invalidVote = await requestJson(invalidVoteContext.baseUrl, `/api/rooms/${invalidVoteRoom.roomId}/votes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${invalidVoteRoom.participantToken}`,
      },
      json: { value: "5" },
    });
    expect(invalidVote.response.status).toBe(400);
    expect(invalidVote.body).toEqual({
      code: "INVALID_VOTE",
      message: "Vote value is not in the shared deck.",
    });

    const logs = namesContext.logger.lines.join("\n");
    expect(logs).not.toContain(creator.participantToken);
    expect(logs).not.toContain(creator.facilitatorToken);
    expect(logs).not.toContain(ticket);
  });

  it("issues one-time stream tickets and sends the first SSE snapshot with the required headers", async () => {
    const context = await createTestContext();
    openContexts.add(context);

    const created = await requestJson(context.baseUrl, "/api/rooms", {
      method: "POST",
      json: { displayName: "Alex" },
    });
    const creator = created.body as { roomId: string; participantToken: string };
    const expectedSnapshot = encodeSnapshot(context.rooms.snapshotFor(creator.roomId, creator.participantToken));

    const ticketResponse = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}/stream-ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
      },
    });

    expect(ticketResponse.response.status).toBe(201);
    expect(ticketResponse.body).toEqual({
      ticket: expect.any(String),
      expiresInSeconds: 30,
    });

    const ticket = (ticketResponse.body as { ticket: string }).ticket;
    const stream = await openStream(context.baseUrl, creator.roomId, ticket);

    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get("content-type")).toBe("text/event-stream");
    expect(stream.response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(stream.response.headers.get("connection")).toBe("keep-alive");
    expect(stream.response.headers.get("x-accel-buffering")).toBe("no");
    expect(stream.chunk).toBe(`event: snapshot\ndata: ${JSON.stringify(expectedSnapshot)}\n\n`);
  });

  it("publishes personalized complete snapshots to open streams after an accepted mutation", async () => {
    const context = await createTestContext();
    openContexts.add(context);

    const created = await requestJson(context.baseUrl, "/api/rooms", {
      method: "POST",
      json: { displayName: "Alex" },
    });
    const creator = created.body as { roomId: string; participantToken: string };
    const joined = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}/join`, {
      method: "POST",
      json: { displayName: "Sam" },
    });
    const participantToken = (joined.body as { participantToken: string }).participantToken;

    const creatorTicketResponse = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}/stream-ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
      },
    });
    const participantTicketResponse = await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}/stream-ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${participantToken}`,
      },
    });

    const creatorStream = await connectStream(
      context.baseUrl,
      creator.roomId,
      (creatorTicketResponse.body as { ticket: string }).ticket,
    );
    const participantStream = await connectStream(
      context.baseUrl,
      creator.roomId,
      (participantTicketResponse.body as { ticket: string }).ticket,
    );

    await creatorStream.readChunk();
    await participantStream.readChunk();

    await requestJson(context.baseUrl, `/api/rooms/${creator.roomId}/join`, {
      method: "POST",
      json: { displayName: "Taylor" },
    });

    const creatorUpdate = await creatorStream.readChunk();
    const participantUpdate = await participantStream.readChunk();
    const expectedCreatorSnapshot = encodeSnapshot(context.rooms.snapshotFor(creator.roomId, creator.participantToken));
    const expectedParticipantSnapshot = encodeSnapshot(context.rooms.snapshotFor(creator.roomId, participantToken));

    expect(creatorUpdate).toBe(`event: snapshot\ndata: ${JSON.stringify(expectedCreatorSnapshot)}\n\n`);
    expect(participantUpdate).toBe(`event: snapshot\ndata: ${JSON.stringify(expectedParticipantSnapshot)}\n\n`);
    expect(expectedCreatorSnapshot.s).not.toBe(expectedParticipantSnapshot.s);
    expect(expectedCreatorSnapshot.u).toEqual(expectedParticipantSnapshot.u);

    await creatorStream.close();
    await participantStream.close();
  });

  it("enforces per-key rate limits for creations, joins, actions, and stream tickets", async () => {
    const createContext = await createTestContext({ nodeEnv: "production" });
    openContexts.add(createContext);

    for (let index = 0; index < 10; index += 1) {
      const created = await requestJson(createContext.baseUrl, "/api/rooms", {
        method: "POST",
        headers: {
          "X-Forwarded-For": "198.51.100.10",
        },
        json: { displayName: `Host ${index}` },
      });

      expect(created.response.status).toBe(201);
    }

    const tooManyCreates = await requestJson(createContext.baseUrl, "/api/rooms", {
      method: "POST",
      headers: {
        "X-Forwarded-For": "198.51.100.10",
      },
      json: { displayName: "Overflow" },
    });
    expect(tooManyCreates.response.status).toBe(429);

    const joinIpContext = await createTestContext({ nodeEnv: "production" });
    openContexts.add(joinIpContext);

    for (let index = 0; index < 30; index += 1) {
      const room = await requestJson(joinIpContext.baseUrl, "/api/rooms", {
        method: "POST",
        headers: {
          "X-Forwarded-For": `192.0.2.${index + 1}`,
        },
        json: { displayName: `Host ${index}` },
      });
      const roomId = (room.body as { roomId: string }).roomId;
      const joined = await requestJson(joinIpContext.baseUrl, `/api/rooms/${roomId}/join`, {
        method: "POST",
        headers: {
          "X-Forwarded-For": "203.0.113.20",
        },
        json: { displayName: `Sam ${index}` },
      });

      expect(joined.response.status).toBe(201);
    }

    const overflowRoom = await requestJson(joinIpContext.baseUrl, "/api/rooms", {
      method: "POST",
      headers: {
        "X-Forwarded-For": "192.0.2.250",
      },
      json: { displayName: "Host overflow" },
    });
    const joinIpRateLimited = await requestJson(
      joinIpContext.baseUrl,
      `/api/rooms/${(overflowRoom.body as { roomId: string }).roomId}/join`,
      {
        method: "POST",
        headers: {
          "X-Forwarded-For": "203.0.113.20",
        },
        json: { displayName: "Blocked join" },
      },
    );
    expect(joinIpRateLimited.response.status).toBe(429);

    const joinRoomContext = await createTestContext({ nodeEnv: "production" });
    openContexts.add(joinRoomContext);

    const roomCreated = await requestJson(joinRoomContext.baseUrl, "/api/rooms", {
      method: "POST",
      headers: {
        "X-Forwarded-For": "198.51.100.1",
      },
      json: { displayName: "Host" },
    });
    const joinRoomId = (roomCreated.body as { roomId: string }).roomId;

    for (let index = 0; index < 40; index += 1) {
      const joined = await requestJson(joinRoomContext.baseUrl, `/api/rooms/${joinRoomId}/join`, {
        method: "POST",
        headers: {
          "X-Forwarded-For": `203.0.113.${index + 1}`,
        },
        json: { displayName: `Player ${index}` },
      });

      if (index < 19) {
        expect(joined.response.status).toBe(201);
      } else {
        expect(joined.response.status).toBe(409);
        expect(joined.body).toEqual({
          code: "ROOM_FULL",
          message: "This room already has 20 participants.",
        });
      }
    }

    const joinRoomRateLimited = await requestJson(joinRoomContext.baseUrl, `/api/rooms/${joinRoomId}/join`, {
      method: "POST",
      headers: {
        "X-Forwarded-For": "203.0.113.99",
      },
      json: { displayName: "Blocked by room limit" },
    });
    expect(joinRoomRateLimited.response.status).toBe(429);

    const actionContext = await createTestContext();
    openContexts.add(actionContext);

    const actionRoom = await requestJson(actionContext.baseUrl, "/api/rooms", {
      method: "POST",
      json: { displayName: "Alex" },
    });
    const actor = actionRoom.body as { roomId: string; participantToken: string };

    for (let index = 0; index < 120; index += 1) {
      const vote = await requestJson(actionContext.baseUrl, `/api/rooms/${actor.roomId}/votes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${actor.participantToken}`,
        },
        json: { value: index % 2 === 0 ? "3" : "5" },
      });

      expect(vote.response.status).toBe(204);
    }

    const actionRateLimited = await requestJson(actionContext.baseUrl, `/api/rooms/${actor.roomId}/votes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${actor.participantToken}`,
      },
      json: { value: "8" },
    });
    expect(actionRateLimited.response.status).toBe(429);

    const ticketContext = await createTestContext();
    openContexts.add(ticketContext);

    const ticketRoom = await requestJson(ticketContext.baseUrl, "/api/rooms", {
      method: "POST",
      json: { displayName: "Alex" },
    });
    const ticketOwner = ticketRoom.body as { roomId: string; participantToken: string };

    for (let index = 0; index < 20; index += 1) {
      const issued = await requestJson(ticketContext.baseUrl, `/api/rooms/${ticketOwner.roomId}/stream-ticket`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ticketOwner.participantToken}`,
        },
      });

      expect(issued.response.status).toBe(201);
    }

    const ticketRateLimited = await requestJson(ticketContext.baseUrl, `/api/rooms/${ticketOwner.roomId}/stream-ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ticketOwner.participantToken}`,
      },
    });
    expect(ticketRateLimited.response.status).toBe(429);
  });

  it("reports live and ready health and strips stream query strings from logs", async () => {
    const readyContext = await createTestContext({ ready: true });
    openContexts.add(readyContext);

    const live = await requestJson(readyContext.baseUrl, "/health/live");
    expect(live.response.status).toBe(200);
    expect(live.body).toEqual({ ok: true });

    const ready = await requestJson(readyContext.baseUrl, "/health/ready");
    expect(ready.response.status).toBe(200);
    expect(ready.body).toEqual({ ok: true });

    const notReadyContext = await createTestContext({ ready: false });
    openContexts.add(notReadyContext);

    const notReady = await requestJson(notReadyContext.baseUrl, "/health/ready");
    expect(notReady.response.status).toBe(503);
    expect(notReady.body).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: expect.any(String),
    });

    const created = await requestJson(readyContext.baseUrl, "/api/rooms", {
      method: "POST",
      json: { displayName: "Alex" },
    });
    const creator = created.body as { roomId: string; participantToken: string };

    const ticketResponse = await requestJson(readyContext.baseUrl, `/api/rooms/${creator.roomId}/stream-ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
      },
    });
    const ticket = (ticketResponse.body as { ticket: string }).ticket;

    await openStream(readyContext.baseUrl, creator.roomId, ticket);

    const logs = readyContext.logger.lines.join("\n");
    expect(logs).toContain("/api/rooms");
    expect(logs).toContain(`/api/rooms/${creator.roomId}/stream`);
    expect(logs).not.toContain("ticket=");
    expect(logs).not.toContain(ticket);
    expect(logs).not.toContain(creator.participantToken);
    expect(logs).not.toContain("Bearer ");
  });
});
