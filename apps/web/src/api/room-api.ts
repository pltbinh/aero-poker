import type {
  ApiErrorCode,
  CreatedRoomResponse,
  JoinedRoomResponse,
  StreamTicketResponse,
  VoteValue,
} from "@scrum-poker/protocol";

const REQUEST_TIMEOUT_MS = 10_000;

export interface RoomApi {
  createRoom(displayName: string): Promise<CreatedRoomResponse>;
  joinRoom(roomId: string, displayName: string): Promise<JoinedRoomResponse>;
  createStreamTicket(roomId: string, participantToken: string): Promise<string>;
  vote(roomId: string, participantToken: string, value: VoteValue): Promise<void>;
  reveal(roomId: string, participantToken: string, facilitatorToken: string): Promise<void>;
  reset(roomId: string, participantToken: string, facilitatorToken: string): Promise<void>;
}

interface RoomApiOptions {
  baseUrl?: string;
}

interface ApiErrorResponse {
  code: ApiErrorCode;
  message: string;
}

export class RoomApiError extends Error {
  readonly name = "RoomApiError";

  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

function readBaseUrl(providedBaseUrl?: string): string {
  const envBaseUrl = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL;
  const baseUrl = providedBaseUrl ?? envBaseUrl;

  if (baseUrl === undefined || baseUrl.trim().length === 0) {
    throw new Error("VITE_API_BASE_URL is required.");
  }

  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function buildUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ""), baseUrl).toString();
}

function createSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function createHeaders(
  participantToken?: string,
  facilitatorToken?: string,
  json = false,
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (json) {
    headers["content-type"] = "application/json";
  }

  if (participantToken !== undefined) {
    headers.authorization = `Bearer ${participantToken}`;
  }

  if (facilitatorToken !== undefined) {
    headers["x-facilitator-token"] = facilitatorToken;
  }

  return headers;
}

async function readResponseBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ApiErrorResponse).code === "string" &&
    typeof (value as ApiErrorResponse).message === "string"
  );
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  let parsedBody: unknown = null;

  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = null;
  }

  if (isApiErrorResponse(parsedBody)) {
    throw new RoomApiError(parsedBody.code, response.status, parsedBody.message);
  }

  throw new RoomApiError("SERVICE_UNAVAILABLE", response.status, "The service is unavailable.");
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(buildUrl(baseUrl, path), {
    ...init,
    credentials: "omit",
    signal: createSignal(),
  });

  await assertOk(response);
  return readResponseBody<T>(response);
}

async function requestVoid(
  baseUrl: string,
  path: string,
  init: RequestInit,
): Promise<void> {
  const response = await fetch(buildUrl(baseUrl, path), {
    ...init,
    credentials: "omit",
    signal: createSignal(),
  });

  await assertOk(response);
}

export function createRoomApi(options: RoomApiOptions = {}): RoomApi {
  const baseUrl = readBaseUrl(options.baseUrl);

  return {
    createRoom(displayName) {
      return requestJson<CreatedRoomResponse>(baseUrl, "/api/rooms", {
        method: "POST",
        headers: createHeaders(undefined, undefined, true),
        body: JSON.stringify({ displayName }),
      });
    },
    joinRoom(roomId, displayName) {
      return requestJson<JoinedRoomResponse>(baseUrl, `/api/rooms/${encodeURIComponent(roomId)}/join`, {
        method: "POST",
        headers: createHeaders(undefined, undefined, true),
        body: JSON.stringify({ displayName }),
      });
    },
    async createStreamTicket(roomId, participantToken) {
      const response = await requestJson<StreamTicketResponse>(
        baseUrl,
        `/api/rooms/${encodeURIComponent(roomId)}/stream-ticket`,
        {
          method: "POST",
          headers: createHeaders(participantToken),
        },
      );

      return response.ticket;
    },
    vote(roomId, participantToken, value) {
      return requestVoid(baseUrl, `/api/rooms/${encodeURIComponent(roomId)}/votes`, {
        method: "POST",
        headers: createHeaders(participantToken, undefined, true),
        body: JSON.stringify({ value }),
      });
    },
    reveal(roomId, participantToken, facilitatorToken) {
      return requestVoid(baseUrl, `/api/rooms/${encodeURIComponent(roomId)}/reveal`, {
        method: "POST",
        headers: createHeaders(participantToken, facilitatorToken),
      });
    },
    reset(roomId, participantToken, facilitatorToken) {
      return requestVoid(baseUrl, `/api/rooms/${encodeURIComponent(roomId)}/reset`, {
        method: "POST",
        headers: createHeaders(participantToken, facilitatorToken),
      });
    },
  };
}
