import { useCallback, useEffect, useReducer, useRef } from "react";
import { decodeSnapshot } from "@scrum-poker/protocol";
import type { RoomApi } from "../api/room-api.js";
import { RoomApiError } from "../api/room-api.js";
import {
  initialRoomConnectionState,
  roomReducer,
  type RoomConnectionState,
  type RoomConnectionStatus,
} from "./room-reducer.js";

type VisibilityState = "visible" | "hidden";

interface VisibilityDocumentLike {
  visibilityState: VisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  removeEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

interface SourceListener {
  type: string;
  listener: (event: { data: string }) => void;
}

interface SourceRegistration {
  source: EventSourceLike;
  listeners: SourceListener[];
}

export interface UseRoomConnectionOptions {
  roomId: string;
  participantToken: string;
  api: Pick<RoomApi, "createStreamTicket">;
  apiBaseUrl: string;
  random?: () => number;
  visibilityDocument?: VisibilityDocumentLike;
  eventSourceFactory?: (url: string) => EventSourceLike;
}

export interface UseRoomConnectionResult {
  snapshot: RoomConnectionState["snapshot"];
  status: RoomConnectionStatus;
  lastError: unknown;
  reconnect: () => void;
}

export type UseRoomConnectionHook = (options: UseRoomConnectionOptions) => UseRoomConnectionResult;

class RoomExpiredError extends Error {
  readonly name = "RoomExpiredError";

  constructor(message = "The room is no longer available.") {
    super(message);
  }
}

function readVisibilityDocument(): VisibilityDocumentLike | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  return document as VisibilityDocumentLike;
}

function createEventSource(url: string): EventSourceLike {
  return new EventSource(url);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function buildStreamUrl(baseUrl: string, roomId: string, ticket: string): string {
  return new URL(
    `api/rooms/${encodeURIComponent(roomId)}/stream?ticket=${encodeURIComponent(ticket)}`,
    normalizeBaseUrl(baseUrl),
  ).toString();
}

function nextDelayMs(attempt: number, random: () => number): number {
  return Math.min(1000 * 2 ** attempt, 30_000) * random();
}

function isHidden(documentLike: VisibilityDocumentLike | undefined): boolean {
  return documentLike?.visibilityState === "hidden";
}

export function useRoomConnection(options: UseRoomConnectionOptions): UseRoomConnectionResult {
  const [state, dispatch] = useReducer(roomReducer, initialRoomConnectionState);
  const sourceRef = useRef<SourceRegistration | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const teardownRef = useRef(false);
  const stateRef = useRef(state);

  stateRef.current = state;

  const visibilityDocument = options.visibilityDocument ?? readVisibilityDocument();
  const eventSourceFactory = options.eventSourceFactory ?? createEventSource;
  const random = options.random ?? Math.random;

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const closeSource = useCallback(() => {
    const registration = sourceRef.current;

    if (registration === null) {
      return;
    }

    for (const { type, listener } of registration.listeners) {
      registration.source.removeEventListener(type, listener);
    }

    registration.source.close();
    sourceRef.current = null;
  }, []);

  const scheduleReconnect = useCallback(
    (error: unknown, status: "reconnecting" | "offline") => {
      if (teardownRef.current || isHidden(visibilityDocument)) {
        return;
      }

      dispatch({ type: status, error });
      clearRetryTimer();

      const attempt = reconnectAttemptsRef.current;
      reconnectAttemptsRef.current += 1;

      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        void connect();
      }, nextDelayMs(attempt, random));
    },
    [clearRetryTimer, random, visibilityDocument],
  );

  const connect = useCallback(async () => {
    if (teardownRef.current || isHidden(visibilityDocument)) {
      return;
    }

    closeSource();
    clearRetryTimer();

    if (stateRef.current.snapshot === null) {
      dispatch({ type: "connecting" });
    } else {
      dispatch({ type: "reconnecting", error: stateRef.current.lastError });
    }

    try {
      const ticket = await options.api.createStreamTicket(options.roomId, options.participantToken);

      if (teardownRef.current || isHidden(visibilityDocument)) {
        return;
      }

      const source = eventSourceFactory(buildStreamUrl(options.apiBaseUrl, options.roomId, ticket));

      const handleSnapshot = (event: { data: string }) => {
        try {
          const snapshot = decodeSnapshot(JSON.parse(event.data));
          reconnectAttemptsRef.current = 0;
          dispatch({ type: "snapshot", snapshot });
        } catch (error) {
          closeSource();
          scheduleReconnect(error, "reconnecting");
        }
      };
      const handleError = (_event: { data: string }) => {
        closeSource();
        scheduleReconnect(new Error("The room connection was interrupted."), "reconnecting");
      };
      const handleExpired = (_event: { data: string }) => {
        closeSource();
        clearRetryTimer();
        dispatch({
          type: "expired",
          error: new RoomExpiredError(),
        });
      };

      const listeners = [
        { type: "snapshot", listener: handleSnapshot },
        { type: "error", listener: handleError },
        { type: "room-expired", listener: handleExpired },
      ];
      sourceRef.current = { source, listeners };

      for (const { type, listener } of listeners) {
        source.addEventListener(type, listener);
      }
    } catch (error) {
      if (error instanceof RoomApiError && error.code === "ROOM_NOT_FOUND") {
        dispatch({
          type: "expired",
          error: new RoomExpiredError(error.message),
        });
        return;
      }

      scheduleReconnect(error, error instanceof RoomApiError ? "reconnecting" : "offline");
    }
  }, [
    clearRetryTimer,
    closeSource,
    eventSourceFactory,
    options.api,
    options.apiBaseUrl,
    options.participantToken,
    options.roomId,
    scheduleReconnect,
    visibilityDocument,
  ]);

  useEffect(() => {
    teardownRef.current = false;
    void connect();

    return () => {
      teardownRef.current = true;
      clearRetryTimer();
      closeSource();
    };
  }, [clearRetryTimer, closeSource, connect]);

  useEffect(() => {
    if (visibilityDocument === undefined) {
      return;
    }

    const handleVisibilityChange = () => {
      if (visibilityDocument.visibilityState === "hidden") {
        clearRetryTimer();
        closeSource();

        if (stateRef.current.snapshot !== null) {
          dispatch({
            type: "reconnecting",
            error: stateRef.current.lastError,
          });
        }

        return;
      }

      reconnectAttemptsRef.current = 0;
      void connect();
    };

    visibilityDocument.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      visibilityDocument.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [clearRetryTimer, closeSource, connect, visibilityDocument]);

  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    closeSource();
    clearRetryTimer();
    void connect();
  }, [clearRetryTimer, closeSource, connect]);

  return {
    snapshot: state.snapshot,
    status: state.status,
    lastError: state.lastError,
    reconnect,
  };
}
