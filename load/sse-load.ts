import { setMaxListeners } from "node:events";
import { TextDecoder } from "node:util";
import { decodeSnapshot, type RoomSnapshot, type VoteValue } from "@scrum-poker/protocol";

const DEFAULT_ROOMS = 5;
const DEFAULT_PARTICIPANTS_PER_ROOM = 20;
const DEFAULT_DURATION_SECONDS = 300;
const DEFAULT_ALLOWED_UNEXPECTED_DISCONNECTS = 0;
const DEFAULT_RSS_CEILING_MIB = 220;
const REQUIRED_CLIENTS = 100;
const REQUEST_TIMEOUT_MS = 10_000;
const STREAM_CONNECT_TIMEOUT_MS = 10_000;
const INITIAL_SNAPSHOT_TIMEOUT_MS = 10_000;

interface LoggerLike {
  error(message: string): void;
  info(message: string): void;
}

interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

interface LoadDependencies {
  fetch?: FetchLike;
  logger?: LoggerLike;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

interface CreatedRoomResponse {
  facilitatorToken: string;
  participantToken: string;
  roomId: string;
}

interface JoinedRoomResponse {
  participantToken: string;
}

interface StreamTicketResponse {
  expiresInSeconds: number;
  ticket: string;
}

interface ParticipantSession {
  forwardedFor: string;
  label: string;
  participantToken: string;
}

interface RoomSession {
  facilitator: ParticipantSession;
  facilitatorToken: string;
  participants: ParticipantSession[];
  roomId: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
  settled: () => boolean;
}

interface OpenStream {
  close: () => Promise<void>;
  initialSnapshot: Promise<void>;
}

export interface LoadOptions {
  allowedUnexpectedDisconnects: number;
  baseUrl: string;
  durationSeconds: number;
  expectedClients: number;
  participantsPerRoom: number;
  rooms: number;
  rssCeilingMiB: number;
}

export interface LoadResult {
  allowedUnexpectedDisconnects: number;
  completedRooms: number;
  connectedClients: number;
  durationMs: number;
  expectedClients: number;
  initialSnapshots: number;
  receivedBytes: number;
  roomsAttempted: number;
  rssMiB?: number;
  unexpectedDisconnects: number;
}

export interface EvaluatedLoadResult {
  metrics: LoadResult;
  ok: boolean;
  reasons: string[];
}

function createDeferred<T>(): Deferred<T> {
  let isSettled = false;
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = (value) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      promiseResolve(value);
    };
    reject = (error) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      promiseReject(error);
    };
  });

  return {
    promise,
    reject,
    resolve,
    settled: () => isSettled,
  };
}

function parsePositiveInteger(rawValue: string | undefined, flagName: string): number {
  if (rawValue === undefined || !/^\d+$/.test(rawValue)) {
    throw new Error(`${flagName} must be a positive integer.`);
  }

  const parsed = Number(rawValue);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer.`);
  }

  return parsed;
}

function parseNonNegativeInteger(rawValue: string | undefined, flagName: string): number {
  if (rawValue === undefined || !/^\d+$/.test(rawValue)) {
    throw new Error(`${flagName} must be a non-negative integer.`);
  }

  const parsed = Number(rawValue);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative integer.`);
  }

  return parsed;
}

function parseArgs(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === undefined) {
      break;
    }

    if (current === "--") {
      continue;
    }

    if (!current.startsWith("--")) {
      throw new Error(`Unexpected argument: ${current}`);
    }

    const equalsIndex = current.indexOf("=");

    if (equalsIndex >= 0) {
      const key = current.slice(2, equalsIndex);
      const value = current.slice(equalsIndex + 1);
      parsed.set(key, value);
      continue;
    }

    const key = current.slice(2);
    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}.`);
    }

    parsed.set(key, value);
    index += 1;
  }

  return parsed;
}

function normalizeBaseUrl(rawBaseUrl: string | undefined): string {
  if (rawBaseUrl === undefined || rawBaseUrl.trim().length === 0) {
    throw new Error("An explicit --base-url is required.");
  }

  let parsed: URL;

  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new Error("The --base-url value must be a valid HTTP URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The --base-url value must be a valid HTTP URL.");
  }

  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!loopbackHosts.has(parsed.hostname)) {
    throw new Error("Production-looking base URLs are rejected. Use an explicit local loopback URL.");
  }

  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("The --base-url value must point to the API origin only.");
  }

  return parsed.toString().replace(/\/$/, "");
}

export function parseLoadOptions(argv: readonly string[]): LoadOptions {
  const args = parseArgs(argv);
  const rooms = args.has("rooms") ? parsePositiveInteger(args.get("rooms"), "--rooms") : DEFAULT_ROOMS;
  const participantsPerRoom = args.has("participants-per-room")
    ? parsePositiveInteger(args.get("participants-per-room"), "--participants-per-room")
    : DEFAULT_PARTICIPANTS_PER_ROOM;
  const expectedClients = rooms * participantsPerRoom;

  if (expectedClients !== REQUIRED_CLIENTS) {
    throw new Error(`Load shape must resolve to exactly ${REQUIRED_CLIENTS} clients.`);
  }

  return {
    allowedUnexpectedDisconnects: args.has("allowed-unexpected-disconnects")
      ? parseNonNegativeInteger(args.get("allowed-unexpected-disconnects"), "--allowed-unexpected-disconnects")
      : DEFAULT_ALLOWED_UNEXPECTED_DISCONNECTS,
    baseUrl: normalizeBaseUrl(args.get("base-url")),
    durationSeconds: args.has("duration-seconds")
      ? parsePositiveInteger(args.get("duration-seconds"), "--duration-seconds")
      : DEFAULT_DURATION_SECONDS,
    expectedClients,
    participantsPerRoom,
    rooms,
    rssCeilingMiB: args.has("rss-ceiling-mib")
      ? parsePositiveInteger(args.get("rss-ceiling-mib"), "--rss-ceiling-mib")
      : DEFAULT_RSS_CEILING_MIB,
  };
}

export function evaluateLoadResult(result: LoadResult, rssCeilingMiB = DEFAULT_RSS_CEILING_MIB): EvaluatedLoadResult {
  const reasons: string[] = [];
  const allowedUnexpectedDisconnects = result.allowedUnexpectedDisconnects ?? DEFAULT_ALLOWED_UNEXPECTED_DISCONNECTS;

  if (result.connectedClients !== result.expectedClients) {
    reasons.push(`Expected ${result.expectedClients} connected clients but observed ${result.connectedClients}.`);
  }

  if (result.initialSnapshots !== result.expectedClients) {
    reasons.push(`Expected ${result.expectedClients} initial snapshots but observed ${result.initialSnapshots}.`);
  }

  if (result.completedRooms !== result.roomsAttempted) {
    reasons.push(`Expected ${result.roomsAttempted} completed rooms but observed ${result.completedRooms}.`);
  }

  if (result.unexpectedDisconnects > allowedUnexpectedDisconnects) {
    reasons.push(
      `Expected ${allowedUnexpectedDisconnects} or fewer unexpected disconnects but observed ${result.unexpectedDisconnects}.`,
    );
  }

  if (result.rssMiB !== undefined && result.rssMiB > rssCeilingMiB) {
    reasons.push(`Observed RSS ${result.rssMiB} MiB exceeds the ${rssCeilingMiB} MiB ceiling.`);
  }

  return {
    metrics: result,
    ok: reasons.length === 0,
    reasons,
  };
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error("The operation was aborted."));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError")
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function createRequestTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function buildApiUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ""), `${baseUrl}/`).toString();
}

function sanitizeLogMessage(message: string): string {
  return message
    .replace(/ticket=[^&\s]+/gi, "ticket=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]");
}

function safeLog(logger: LoggerLike, level: "info" | "error", message: string): void {
  logger[level](sanitizeLogMessage(message));
}

async function readJsonResponse<T>(response: Response, failureLabel: string): Promise<T> {
  let parsedBody: unknown;

  try {
    parsedBody = await response.json();
  } catch {
    throw new Error(`${failureLabel} returned a non-JSON response.`);
  }

  return parsedBody as T;
}

async function requestJson<T>(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  failureLabel: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchImpl(buildApiUrl(baseUrl, path), {
    ...init,
    signal: createRequestTimeoutSignal(),
  });

  if (!response.ok) {
    throw new Error(`${failureLabel} returned HTTP ${response.status}.`);
  }

  return readJsonResponse<T>(response, failureLabel);
}

async function requestVoid(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  failureLabel: string,
  init: RequestInit,
): Promise<void> {
  const response = await fetchImpl(buildApiUrl(baseUrl, path), {
    ...init,
    signal: createRequestTimeoutSignal(),
  });

  if (!response.ok) {
    throw new Error(`${failureLabel} returned HTTP ${response.status}.`);
  }
}

async function createRooms(
  fetchImpl: FetchLike,
  options: LoadOptions,
): Promise<RoomSession[]> {
  const rooms: RoomSession[] = [];

  for (let roomIndex = 0; roomIndex < options.rooms; roomIndex += 1) {
    const created = await requestJson<CreatedRoomResponse>(
      fetchImpl,
      options.baseUrl,
      "/api/rooms",
      `Create room ${roomIndex + 1}`,
      {
        body: JSON.stringify({ displayName: `Host ${roomIndex + 1}` }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `198.51.100.${roomIndex + 1}`,
        },
        method: "POST",
      },
    );

    const facilitator: ParticipantSession = {
      forwardedFor: `198.51.100.${roomIndex + 1}`,
      label: `room-${roomIndex + 1}-host`,
      participantToken: created.participantToken,
    };
    const participants = [facilitator];

    for (let participantIndex = 1; participantIndex < options.participantsPerRoom; participantIndex += 1) {
      const joined = await requestJson<JoinedRoomResponse>(
        fetchImpl,
        options.baseUrl,
        `/api/rooms/${encodeURIComponent(created.roomId)}/join`,
        `Join room ${roomIndex + 1} participant ${participantIndex + 1}`,
        {
          body: JSON.stringify({ displayName: `Player ${roomIndex + 1}-${participantIndex + 1}` }),
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": `203.0.${roomIndex + 1}.${participantIndex + 1}`,
          },
          method: "POST",
        },
      );

      participants.push({
        forwardedFor: `203.0.${roomIndex + 1}.${participantIndex + 1}`,
        label: `room-${roomIndex + 1}-participant-${participantIndex + 1}`,
        participantToken: joined.participantToken,
      });
    }

    rooms.push({
      facilitator,
      facilitatorToken: created.facilitatorToken,
      participants,
      roomId: created.roomId,
    });
  }

  return rooms;
}

async function issueStreamTicket(
  fetchImpl: FetchLike,
  baseUrl: string,
  roomId: string,
  participant: ParticipantSession,
): Promise<string> {
  const issued = await requestJson<StreamTicketResponse>(
    fetchImpl,
    baseUrl,
    `/api/rooms/${encodeURIComponent(roomId)}/stream-ticket`,
    `Create stream ticket for ${participant.label}`,
    {
      headers: {
        authorization: `Bearer ${participant.participantToken}`,
        "x-forwarded-for": participant.forwardedFor,
      },
      method: "POST",
    },
  );

  if (issued.expiresInSeconds !== 30) {
    throw new Error(`Create stream ticket for ${participant.label} returned an unexpected expiry.`);
  }

  return issued.ticket;
}

function readSseFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = buffer.replace(/\r/g, "");
  const frames: string[] = [];
  let searchIndex = 0;
  let frameBoundary = normalized.indexOf("\n\n", searchIndex);

  while (frameBoundary >= 0) {
    frames.push(normalized.slice(searchIndex, frameBoundary));
    searchIndex = frameBoundary + 2;
    frameBoundary = normalized.indexOf("\n\n", searchIndex);
  }

  return {
    frames,
    rest: normalized.slice(searchIndex),
  };
}

function parseSnapshotFrame(frame: string, streamLabel: string): RoomSnapshot | null {
  if (frame.length === 0 || frame.startsWith(":")) {
    return null;
  }

  const lines = frame.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (eventName === "room-expired") {
    throw new Error(`SSE room expired for ${streamLabel}.`);
  }

  if (eventName !== "snapshot") {
    return null;
  }

  try {
    return decodeSnapshot(JSON.parse(dataLines.join("\n")));
  } catch (error) {
    throw new Error(`SSE snapshot parsing failed for ${streamLabel}: ${errorMessage(error)}`);
  }
}

async function openStream(
  fetchImpl: FetchLike,
  baseUrl: string,
  roomId: string,
  participant: ParticipantSession,
  ticket: string,
  totalReceivedBytes: { value: number },
  initialSnapshotCount: { value: number },
  abortSignal: AbortSignal,
  onUnexpectedDisconnect: (error: Error) => void,
  initialSnapshotTimeoutMs: number,
): Promise<OpenStream> {
  const controller = new AbortController();
  const initialSnapshotDeferred = createDeferred<void>();
  const streamClosedDeferred = createDeferred<void>();
  let closedByCaller = false;

  const abortFromRun = () => {
    closedByCaller = true;
    controller.abort(abortSignal.reason);
  };

  if (abortSignal.aborted) {
    abortFromRun();
  } else {
    abortSignal.addEventListener("abort", abortFromRun, { once: true });
  }

  const streamUrl = buildApiUrl(baseUrl, `/api/rooms/${encodeURIComponent(roomId)}/stream?ticket=${encodeURIComponent(ticket)}`);

  const streamLoop = (async () => {
    try {
      const response = await fetchImpl(streamUrl, {
        headers: {
          accept: "text/event-stream",
          "x-forwarded-for": participant.forwardedFor,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Open SSE stream for ${participant.label} returned HTTP ${response.status}.`);
      }

      if (response.body === null) {
        throw new Error(`Open SSE stream for ${participant.label} returned no response body.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const chunk = await reader.read();

          if (chunk.done) {
            break;
          }

          totalReceivedBytes.value += chunk.value.byteLength;
          buffer += decoder.decode(chunk.value, { stream: true });
          const parsed = readSseFrames(buffer);
          buffer = parsed.rest;

          for (const frame of parsed.frames) {
            const snapshot = parseSnapshotFrame(frame, participant.label);

            if (snapshot !== null && !initialSnapshotDeferred.settled()) {
              initialSnapshotCount.value += 1;
              initialSnapshotDeferred.resolve();
            }
          }
        }

        buffer += decoder.decode();
        const parsed = readSseFrames(buffer);

        for (const frame of parsed.frames) {
          const snapshot = parseSnapshotFrame(frame, participant.label);

          if (snapshot !== null && !initialSnapshotDeferred.settled()) {
            initialSnapshotCount.value += 1;
            initialSnapshotDeferred.resolve();
          }
        }

        if (!closedByCaller) {
          throw new Error(`SSE stream disconnected for ${participant.label}.`);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (!closedByCaller && !isAbortError(error)) {
        const streamError = error instanceof Error ? error : new Error(errorMessage(error));
        if (!initialSnapshotDeferred.settled()) {
          initialSnapshotDeferred.reject(streamError);
        }
        onUnexpectedDisconnect(streamError);
        streamClosedDeferred.reject(streamError);
        return;
      }

      if (!initialSnapshotDeferred.settled()) {
        initialSnapshotDeferred.reject(new Error(`SSE setup was interrupted for ${participant.label}.`));
      }
    } finally {
      abortSignal.removeEventListener("abort", abortFromRun);
      streamClosedDeferred.resolve();
    }
  })();

  void streamLoop;

  return {
    close: async () => {
      if (closedByCaller) {
        await streamClosedDeferred.promise.catch(() => undefined);
        return;
      }

      closedByCaller = true;
      controller.abort();
      await streamClosedDeferred.promise.catch(() => undefined);
    },
    initialSnapshot: Promise.race([
      initialSnapshotDeferred.promise,
      defaultSleep(initialSnapshotTimeoutMs, controller.signal).then(() => {
        throw new Error(`Timed out waiting for the initial snapshot for ${participant.label}.`);
      }),
    ]),
  };
}

async function openStreams(
  fetchImpl: FetchLike,
  options: LoadOptions,
  rooms: RoomSession[],
  totalReceivedBytes: { value: number },
  initialSnapshotCount: { value: number },
  abortSignal: AbortSignal,
  onUnexpectedDisconnect: (error: Error) => void,
  streams: OpenStream[],
  initialSnapshotTimeoutMs: number,
): Promise<void> {
  const startingStreamCount = streams.length;
  const openResults = await Promise.allSettled(
    rooms.flatMap((room) =>
      room.participants.map(async (participant) => {
        const ticket = await issueStreamTicket(fetchImpl, options.baseUrl, room.roomId, participant);
        const stream = await openStream(
          fetchImpl,
          options.baseUrl,
          room.roomId,
          participant,
          ticket,
          totalReceivedBytes,
          initialSnapshotCount,
          abortSignal,
          onUnexpectedDisconnect,
          initialSnapshotTimeoutMs,
        );

        streams.push(stream);
        return stream;
      }),
    ),
  );

  const openingFailure = openResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  if (openingFailure !== undefined) {
    await closeStreams(streams.slice(startingStreamCount));
    throw openingFailure.reason;
  }

  try {
    await Promise.all(streams.slice(startingStreamCount).map((stream) => stream.initialSnapshot));
  } catch (error) {
    await closeStreams(streams.slice(startingStreamCount));
    throw error;
  }
}

async function vote(
  fetchImpl: FetchLike,
  baseUrl: string,
  roomId: string,
  participant: ParticipantSession,
  value: VoteValue,
): Promise<void> {
  await requestVoid(fetchImpl, baseUrl, `/api/rooms/${encodeURIComponent(roomId)}/votes`, `Vote in ${participant.label}`, {
    body: JSON.stringify({ value }),
    headers: {
      authorization: `Bearer ${participant.participantToken}`,
      "content-type": "application/json",
      "x-forwarded-for": participant.forwardedFor,
    },
    method: "POST",
  });
}

async function reveal(fetchImpl: FetchLike, baseUrl: string, room: RoomSession): Promise<void> {
  await requestVoid(fetchImpl, baseUrl, `/api/rooms/${encodeURIComponent(room.roomId)}/reveal`, `Reveal ${room.roomId}`, {
    headers: {
      authorization: `Bearer ${room.facilitator.participantToken}`,
      "x-facilitator-token": room.facilitatorToken,
      "x-forwarded-for": room.facilitator.forwardedFor,
    },
    method: "POST",
  });
}

async function reset(fetchImpl: FetchLike, baseUrl: string, room: RoomSession): Promise<void> {
  await requestVoid(fetchImpl, baseUrl, `/api/rooms/${encodeURIComponent(room.roomId)}/reset`, `Reset ${room.roomId}`, {
    headers: {
      authorization: `Bearer ${room.facilitator.participantToken}`,
      "x-facilitator-token": room.facilitatorToken,
      "x-forwarded-for": room.facilitator.forwardedFor,
    },
    method: "POST",
  });
}

async function exerciseRooms(fetchImpl: FetchLike, baseUrl: string, rooms: RoomSession[]): Promise<number> {
  let completedRooms = 0;

  for (const room of rooms) {
    await vote(fetchImpl, baseUrl, room.roomId, room.facilitator, "5");
    await vote(fetchImpl, baseUrl, room.roomId, room.participants[1] ?? room.facilitator, "8");
    await reveal(fetchImpl, baseUrl, room);
    await reset(fetchImpl, baseUrl, room);
    completedRooms += 1;
  }

  return completedRooms;
}

async function closeStreams(streams: OpenStream[]): Promise<void> {
  await Promise.allSettled(streams.map((stream) => stream.close()));
}

export async function runLoadCheck(options: LoadOptions, dependencies: LoadDependencies = {}): Promise<LoadResult> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const logger = dependencies.logger ?? console;
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? defaultSleep;
  const totalReceivedBytes = { value: 0 };
  const initialSnapshotCount = { value: 0 };
  const runAbortController = new AbortController();
  setMaxListeners(0, runAbortController.signal);
  const startTimeMs = now();
  let completedRooms = 0;
  let unexpectedDisconnects = 0;
  let firstFailure: Error | null = null;
  const streams: OpenStream[] = [];

  const failRun = (error: Error) => {
    unexpectedDisconnects += 1;

    if (firstFailure !== null) {
      return;
    }

    firstFailure = error;
    runAbortController.abort(error);
  };

  safeLog(
    logger,
    "info",
    `Starting SSE load check for ${options.rooms} rooms and ${options.expectedClients} participants.`,
  );

  try {
    const rooms = await createRooms(fetchImpl, options);
    await openStreams(
      fetchImpl,
      options,
      rooms,
      totalReceivedBytes,
      initialSnapshotCount,
      runAbortController.signal,
      failRun,
      streams,
      INITIAL_SNAPSHOT_TIMEOUT_MS,
    );

    if (firstFailure !== null) {
      throw firstFailure;
    }

    completedRooms = await exerciseRooms(fetchImpl, options.baseUrl, rooms);

    if (firstFailure !== null) {
      throw firstFailure;
    }

    await sleep(options.durationSeconds * 1_000, runAbortController.signal);

    if (firstFailure !== null) {
      throw firstFailure;
    }

    const result: LoadResult = {
      allowedUnexpectedDisconnects: options.allowedUnexpectedDisconnects,
      completedRooms,
      connectedClients: streams.length,
      durationMs: now() - startTimeMs,
      expectedClients: options.expectedClients,
      initialSnapshots: initialSnapshotCount.value,
      receivedBytes: totalReceivedBytes.value,
      roomsAttempted: options.rooms,
      unexpectedDisconnects,
    };

    safeLog(
      logger,
      "info",
      `Completed SSE load check: clients=${result.connectedClients}, initialSnapshots=${result.initialSnapshots}, rooms=${result.completedRooms}/${result.roomsAttempted}, disconnects=${result.unexpectedDisconnects}, bytes=${result.receivedBytes}, durationMs=${result.durationMs}.`,
    );

    return result;
  } catch (error) {
    runAbortController.abort(error);

    if (firstFailure !== null && isAbortError(error)) {
      throw firstFailure;
    }

    throw error;
  } finally {
    await closeStreams(streams);
  }
}

function formatSummary(result: LoadResult, evaluation: EvaluatedLoadResult): string {
  const summary = [
    `allowedUnexpectedDisconnects=${result.allowedUnexpectedDisconnects}`,
    `clients=${result.connectedClients}/${result.expectedClients}`,
    `initialSnapshots=${result.initialSnapshots}`,
    `completedRooms=${result.completedRooms}/${result.roomsAttempted}`,
    `unexpectedDisconnects=${result.unexpectedDisconnects}`,
    `receivedBytes=${result.receivedBytes}`,
    `durationMs=${result.durationMs}`,
  ];

  if (result.rssMiB !== undefined) {
    summary.push(`rssMiB=${result.rssMiB}`);
  }

  if (evaluation.reasons.length > 0) {
    summary.push(`reasons=${evaluation.reasons.join(" | ")}`);
  }

  return summary.join(", ");
}

export async function runCli(argv: readonly string[], dependencies: LoadDependencies = {}): Promise<number> {
  const logger = dependencies.logger ?? console;

  try {
    const options = parseLoadOptions(argv);
    const result = await runLoadCheck(options, dependencies);
    const evaluation = evaluateLoadResult(result, options.rssCeilingMiB);

    safeLog(logger, evaluation.ok ? "info" : "error", formatSummary(result, evaluation));
    return evaluation.ok ? 0 : 1;
  } catch (error) {
    safeLog(logger, "error", errorMessage(error));
    return 1;
  }
}

const isMain =
  typeof require === "function" &&
  typeof module !== "undefined" &&
  require.main === module;

if (isMain) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
