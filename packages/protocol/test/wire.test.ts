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
