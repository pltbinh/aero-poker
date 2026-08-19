import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import {
  createRoomRequestSchema,
  encodeSnapshot,
  joinRoomRequestSchema,
  voteRequestSchema,
} from "@scrum-poker/protocol";
import { ZodError } from "zod";
import type { AppConfig } from "./config.js";
import { ApiError } from "./errors/api-error.js";
import { SlidingWindowRateLimiter } from "./rate-limit/sliding-window.js";
import { RoomStore } from "./rooms/room-store.js";
import { StreamTicketStore } from "./streams/stream-tickets.js";
import { SseHub } from "./streams/sse-hub.js";

const CREATE_LIMIT = 10;
const JOIN_IP_LIMIT = 30;
const JOIN_ROOM_LIMIT = 40;
const ACTION_LIMIT = 120;
const TICKET_LIMIT = 20;
const JSON_LIMIT = "4kb";

interface LoggerLike {
  info(message: string): void;
  error(message: string): void;
}

interface ReadinessLike {
  isReady(): boolean;
}

export interface CreateAppDependencies {
  config: AppConfig;
  rooms: RoomStore;
  tickets: StreamTicketStore;
  hub: SseHub;
  logger?: LoggerLike;
  now?: () => number;
  readiness?: ReadinessLike;
}

function invalidRequest(message = "Request body is invalid."): ApiError {
  return new ApiError("INVALID_REQUEST", 400, message);
}

function invalidParticipantToken(): ApiError {
  return new ApiError("INVALID_TOKEN", 401, "Participant credentials are invalid.");
}

function invalidFacilitatorToken(): ApiError {
  return new ApiError("INVALID_TOKEN", 401, "Facilitator credentials are invalid.");
}

function serviceUnavailable(message = "The service is not ready."): ApiError {
  return new ApiError("SERVICE_UNAVAILABLE", 503, message);
}

function parseBody<T>(schema: { parse(input: unknown): T }, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw invalidRequest();
    }

    throw error;
  }
}

function readParticipantToken(request: Request): string {
  const authorization = request.header("authorization");

  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    throw invalidParticipantToken();
  }

  const token = authorization.slice("Bearer ".length).trim();

  if (token.length === 0) {
    throw invalidParticipantToken();
  }

  return token;
}

function readFacilitatorToken(request: Request): string {
  const facilitatorToken = request.header("x-facilitator-token")?.trim();

  if (facilitatorToken === undefined || facilitatorToken.length === 0) {
    throw invalidFacilitatorToken();
  }

  return facilitatorToken;
}

function requestPath(request: Request): string {
  return request.path;
}

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}

function sendError(response: Response, error: ApiError): void {
  response.status(error.status).json({
    code: error.code,
    message: error.publicMessage,
  });
}

export function createApp(dependencies: CreateAppDependencies): Express {
  const {
    config,
    rooms,
    tickets,
    hub,
    logger = console,
    now = Date.now,
    readiness = { isReady: () => true },
  } = dependencies;
  const createLimiter = new SlidingWindowRateLimiter(now);
  const joinIpLimiter = new SlidingWindowRateLimiter(now);
  const joinRoomLimiter = new SlidingWindowRateLimiter(now);
  const actionLimiter = new SlidingWindowRateLimiter(now);
  const ticketLimiter = new SlidingWindowRateLimiter(now);
  const app = express();

  app.set("trust proxy", config.nodeEnv === "production" ? 1 : false);

  app.use((request, response, next) => {
    response.on("finish", () => {
      logger.info(`${request.method} ${requestPath(request)} ${response.statusCode}`);
    });
    next();
  });

  app.use((request, response, next) => {
    const origin = request.header("origin");

    if (origin !== undefined && config.corsOrigins.includes(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.append("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Facilitator-Token");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }

    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }

    next();
  });

  app.use(helmet());
  app.use(express.json({ limit: JSON_LIMIT }));

  app.get("/health/live", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/health/ready", (_request, response) => {
    if (!readiness.isReady()) {
      sendError(response, serviceUnavailable());
      return;
    }

    response.json({ ok: true });
  });

  app.post("/api/rooms", (request, response) => {
    const payload = parseBody(createRoomRequestSchema, request.body);
    createLimiter.consume(clientIp(request), CREATE_LIMIT);

    const created = rooms.createRoom(payload.displayName);
    hub.publishRoom(created.roomId, (participantId) => rooms.snapshotForParticipant(created.roomId, participantId));

    response.status(201).json({
      roomId: created.roomId,
      participantToken: created.participantToken,
      facilitatorToken: created.facilitatorToken,
    });
  });

  app.get("/api/rooms/:roomId", (request, response) => {
    const participantToken = readParticipantToken(request);
    const snapshot = rooms.snapshotFor(request.params.roomId, participantToken);

    response.json(encodeSnapshot(snapshot));
  });

  app.post("/api/rooms/:roomId/join", (request, response) => {
    const payload = parseBody(joinRoomRequestSchema, request.body);
    joinIpLimiter.consume(clientIp(request), JOIN_IP_LIMIT);
    joinRoomLimiter.consume(request.params.roomId, JOIN_ROOM_LIMIT);

    const joined = rooms.joinRoom(request.params.roomId, payload.displayName);
    hub.publishRoom(request.params.roomId, (participantId) => rooms.snapshotForParticipant(request.params.roomId, participantId));

    response.status(201).json({
      participantToken: joined.participantToken,
    });
  });

  app.post("/api/rooms/:roomId/votes", (request, response) => {
    const payload = parseBody(voteRequestSchema, request.body);
    const participantToken = readParticipantToken(request);
    const participantId = rooms.authenticate(request.params.roomId, participantToken);
    actionLimiter.consume(participantId, ACTION_LIMIT);

    rooms.castVote(request.params.roomId, participantToken, payload.value);
    hub.publishRoom(request.params.roomId, (authorizedParticipantId) =>
      rooms.snapshotForParticipant(request.params.roomId, authorizedParticipantId),
    );

    response.status(204).end();
  });

  app.post("/api/rooms/:roomId/reveal", (request, response) => {
    const participantToken = readParticipantToken(request);
    const facilitatorToken = readFacilitatorToken(request);
    const participantId = rooms.authenticate(request.params.roomId, participantToken);
    actionLimiter.consume(participantId, ACTION_LIMIT);

    rooms.reveal(request.params.roomId, participantToken, facilitatorToken);
    hub.publishRoom(request.params.roomId, (authorizedParticipantId) =>
      rooms.snapshotForParticipant(request.params.roomId, authorizedParticipantId),
    );

    response.status(204).end();
  });

  app.post("/api/rooms/:roomId/reset", (request, response) => {
    const participantToken = readParticipantToken(request);
    const facilitatorToken = readFacilitatorToken(request);
    const participantId = rooms.authenticate(request.params.roomId, participantToken);
    actionLimiter.consume(participantId, ACTION_LIMIT);

    rooms.reset(request.params.roomId, participantToken, facilitatorToken);
    hub.publishRoom(request.params.roomId, (authorizedParticipantId) =>
      rooms.snapshotForParticipant(request.params.roomId, authorizedParticipantId),
    );

    response.status(204).end();
  });

  app.post("/api/rooms/:roomId/stream-ticket", (request, response) => {
    const participantToken = readParticipantToken(request);
    const participantId = rooms.authenticate(request.params.roomId, participantToken);
    ticketLimiter.consume(participantId, TICKET_LIMIT);

    const ticket = tickets.issue(request.params.roomId, participantId);

    response.status(201).json({
      ticket,
      expiresInSeconds: 30,
    });
  });

  app.get("/api/rooms/:roomId/stream", (request, response) => {
    const ticket = request.query.ticket;

    if (typeof ticket !== "string" || ticket.trim().length === 0) {
      throw invalidRequest("A stream ticket is required.");
    }

    const consumed = tickets.consume(request.params.roomId, ticket);
    const initialSnapshot = rooms.snapshotForParticipant(request.params.roomId, consumed.participantId);

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    const cleanup = hub.connect(request.params.roomId, consumed.participantId, response, initialSnapshot);
    response.on("close", cleanup);
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      sendError(response, error);
      return;
    }

    if (error instanceof ZodError) {
      sendError(response, invalidRequest());
      return;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      (error as { type?: string }).type === "entity.too.large"
    ) {
      sendError(response, new ApiError("INVALID_REQUEST", 413, "Request body must be 4 KiB or smaller."));
      return;
    }

    if (error instanceof SyntaxError) {
      sendError(response, invalidRequest("Malformed JSON request body."));
      return;
    }

    logger.error(error instanceof Error ? error.message : "Unexpected server error");
    sendError(response, serviceUnavailable("The service is unavailable."));
  });

  return app;
}
