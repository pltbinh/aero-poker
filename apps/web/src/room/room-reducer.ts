import type { RoomSnapshot } from "@scrum-poker/protocol";

export type RoomConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline" | "expired";

export interface RoomConnectionState {
  status: RoomConnectionStatus;
  snapshot: RoomSnapshot | null;
  lastError: unknown;
}

export type RoomConnectionAction =
  | { type: "connecting" }
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | { type: "reconnecting"; error: unknown }
  | { type: "offline"; error: unknown }
  | { type: "expired"; error: unknown };

export const initialRoomConnectionState: RoomConnectionState = {
  status: "connecting",
  snapshot: null,
  lastError: null,
};

export function roomReducer(
  state: RoomConnectionState,
  action: RoomConnectionAction,
): RoomConnectionState {
  switch (action.type) {
    case "connecting":
      return {
        ...state,
        status: "connecting",
        lastError: null,
      };
    case "snapshot":
      if (state.snapshot !== null && action.snapshot.revision < state.snapshot.revision) {
        return state;
      }

      return {
        status: "connected",
        snapshot:
          state.snapshot !== null && action.snapshot.revision === state.snapshot.revision
            ? state.snapshot
            : action.snapshot,
        lastError: null,
      };
    case "reconnecting":
      return {
        status: "reconnecting",
        snapshot: state.snapshot,
        lastError: action.error,
      };
    case "offline":
      return {
        status: "offline",
        snapshot: state.snapshot,
        lastError: action.error,
      };
    case "expired":
      return {
        status: "expired",
        snapshot: state.snapshot,
        lastError: action.error,
      };
  }
}
