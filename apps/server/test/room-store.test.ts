import { describe, expect, it } from "vitest";
import type { VoteValue } from "@scrum-poker/protocol";
import { RoomStore } from "../src/rooms/room-store.js";

function createClock(start = 0) {
  let current = start;

  return {
    now: () => current,
    advanceBy: (ms: number) => {
      current += ms;
    },
  };
}

describe("RoomStore", () => {
  it("keeps votes hidden until the creator reveals", () => {
    const store = new RoomStore();
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
    const store = new RoomStore();
    const created = store.createRoom("Alex");
    const joined = store.joinRoom(created.roomId, "Sam");

    expect(() => store.reveal(created.roomId, joined.participantToken, created.facilitatorToken)).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });

  it("treats participant names as unique after normalization and case folding", () => {
    const store = new RoomStore();
    const created = store.createRoom("Élodie");

    expect(() => store.joinRoom(created.roomId, "e\u0301LODIE")).toThrowError(
      expect.objectContaining({ code: "NAME_TAKEN" }),
    );
  });

  it("caps rooms at twenty participants", () => {
    const store = new RoomStore();
    const created = store.createRoom("Host");

    for (let index = 1; index < 20; index += 1) {
      store.joinRoom(created.roomId, `Player ${index}`);
    }

    expect(() => store.joinRoom(created.roomId, "Overflow")).toThrowError(
      expect.objectContaining({ code: "ROOM_FULL" }),
    );
  });

  it("uses the latest vote when a participant changes it before reveal", () => {
    const store = new RoomStore();
    const created = store.createRoom("Alex");
    const joined = store.joinRoom(created.roomId, "Sam");

    store.castVote(created.roomId, joined.participantToken, "3");
    store.castVote(created.roomId, joined.participantToken, "8");

    expect(store.snapshotFor(created.roomId, joined.participantToken).participants[1]).toEqual({
      id: joined.participantId,
      displayName: "Sam",
      hasVoted: true,
    });

    store.reveal(created.roomId, created.participantToken, created.facilitatorToken);

    expect(store.snapshotFor(created.roomId, joined.participantToken).participants[1]?.vote).toBe("8");
  });

  it("rejects votes once the room has been revealed", () => {
    const store = new RoomStore();
    const created = store.createRoom("Alex");
    const joined = store.joinRoom(created.roomId, "Sam");

    store.castVote(created.roomId, joined.participantToken, "5");
    store.reveal(created.roomId, created.participantToken, created.facilitatorToken);

    expect(() => store.castVote(created.roomId, joined.participantToken, "8")).toThrowError(
      expect.objectContaining({ code: "VOTING_REVEALED" }),
    );
  });

  it("resets votes from either phase", () => {
    const store = new RoomStore();
    const created = store.createRoom("Alex");
    const joined = store.joinRoom(created.roomId, "Sam");

    store.castVote(created.roomId, joined.participantToken, "5");
    store.reset(created.roomId, created.participantToken, created.facilitatorToken);

    expect(store.snapshotFor(created.roomId, created.participantToken)).toMatchObject({
      phase: "voting",
      participants: [
        { id: created.participantId, displayName: "Alex", hasVoted: false },
        { id: joined.participantId, displayName: "Sam", hasVoted: false },
      ],
    });

    store.castVote(created.roomId, joined.participantToken, "8");
    store.reveal(created.roomId, created.participantToken, created.facilitatorToken);
    store.reset(created.roomId, created.participantToken, created.facilitatorToken);

    expect(store.snapshotFor(created.roomId, joined.participantToken)).toMatchObject({
      phase: "voting",
      participants: [
        { id: created.participantId, displayName: "Alex", hasVoted: false },
        { id: joined.participantId, displayName: "Sam", hasVoted: false },
      ],
    });
  });

  it("rejects invalid participant tokens across authenticated operations", () => {
    const store = new RoomStore();
    const created = store.createRoom("Alex");

    expect(() => store.authenticate(created.roomId, "not-a-real-token")).toThrowError(
      expect.objectContaining({ code: "INVALID_TOKEN" }),
    );
    expect(() => store.snapshotFor(created.roomId, "not-a-real-token")).toThrowError(
      expect.objectContaining({ code: "INVALID_TOKEN" }),
    );
    expect(() => store.castVote(created.roomId, "not-a-real-token", "5")).toThrowError(
      expect.objectContaining({ code: "INVALID_TOKEN" }),
    );
  });

  it("increments revisions only for successful room mutations", () => {
    const store = new RoomStore();
    const created = store.createRoom("Alex");

    expect(store.snapshotFor(created.roomId, created.participantToken).revision).toBe(0);

    const joined = store.joinRoom(created.roomId, "Sam");
    expect(store.snapshotFor(created.roomId, created.participantToken).revision).toBe(1);

    store.castVote(created.roomId, created.participantToken, "3");
    expect(store.snapshotForParticipant(created.roomId, joined.participantId).revision).toBe(2);

    store.reveal(created.roomId, created.participantToken, created.facilitatorToken);
    expect(store.snapshotFor(created.roomId, created.participantToken).revision).toBe(3);

    expect(() => store.reveal(created.roomId, joined.participantToken, created.facilitatorToken)).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );

    expect(store.snapshotFor(created.roomId, created.participantToken).revision).toBe(3);

    store.reset(created.roomId, created.participantToken, created.facilitatorToken);
    expect(store.snapshotFor(created.roomId, created.participantToken).revision).toBe(4);
  });

  it("expires rooms after one hour without refreshing on reconnect activity", () => {
    const clock = createClock();
    const store = new RoomStore({ now: clock.now, roomTtlMs: 60 * 60 * 1000 });
    const created = store.createRoom("Alex");

    clock.advanceBy(30 * 60 * 1000);
    store.joinRoom(created.roomId, "Sam");

    clock.advanceBy(59 * 60 * 1000);
    expect(store.authenticate(created.roomId, created.participantToken)).toBe(created.participantId);
    expect(store.snapshotFor(created.roomId, created.participantToken).participants).toHaveLength(2);

    clock.advanceBy(2 * 60 * 1000);

    expect(store.sweepExpired()).toEqual([created.roomId]);
    expect(() => store.snapshotFor(created.roomId, created.participantToken)).toThrowError(
      expect.objectContaining({ code: "ROOM_NOT_FOUND" }),
    );
  });

  it("rejects votes outside the shared protocol deck", () => {
    const store = new RoomStore();
    const created = store.createRoom("Alex");

    expect(() => store.castVote(created.roomId, created.participantToken, "99" as VoteValue)).toThrowError(
      expect.objectContaining({ code: "INVALID_VOTE" }),
    );
  });
});
