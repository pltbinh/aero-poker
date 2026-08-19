import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@scrum-poker/protocol";
import { roomReducer, type RoomConnectionState } from "../src/room/room-reducer.js";

function snapshotAt(revision: number): RoomSnapshot {
  return {
    roomId: "room-1",
    revision,
    phase: revision % 2 === 0 ? "voting" : "revealed",
    selfParticipantId: "participant-1",
    participants: [
      {
        id: "participant-1",
        displayName: "Alex",
        hasVoted: revision % 2 === 1,
        ...(revision % 2 === 1 ? { vote: "5" as const } : {}),
      },
    ],
  };
}

describe("roomReducer", () => {
  it("ignores an equal or older snapshot", () => {
    const current: RoomConnectionState = {
      status: "connected",
      snapshot: snapshotAt(5),
      lastError: null,
    };

    expect(roomReducer(current, { type: "snapshot", snapshot: snapshotAt(4) })).toBe(current);
    expect(roomReducer(current, { type: "snapshot", snapshot: snapshotAt(5) })).toBe(current);
  });

  it("preserves the latest snapshot while transitioning into reconnecting and offline states", () => {
    const current: RoomConnectionState = {
      status: "connected",
      snapshot: snapshotAt(7),
      lastError: null,
    };
    const reconnectingError = new Error("temporary disconnect");
    const offlineError = new Error("network offline");

    expect(
      roomReducer(current, {
        type: "reconnecting",
        error: reconnectingError,
      }),
    ).toEqual({
      status: "reconnecting",
      snapshot: snapshotAt(7),
      lastError: reconnectingError,
    });

    expect(
      roomReducer(current, {
        type: "offline",
        error: offlineError,
      }),
    ).toEqual({
      status: "offline",
      snapshot: snapshotAt(7),
      lastError: offlineError,
    });
  });
});
