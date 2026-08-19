import { describe, expect, it } from "vitest";
import { encodeSnapshot, type RoomSnapshot } from "@scrum-poker/protocol";
import { SseHub } from "../src/streams/sse-hub.js";

class FakeSink {
  readonly writes: string[] = [];
  endCalls = 0;
  private readonly closeListeners = new Set<() => void>();
  private closed = false;

  constructor(private readonly options: { emitCloseOnEnd?: boolean } = {}) {}

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }

  end(): void {
    this.endCalls += 1;

    if (this.options.emitCloseOnEnd) {
      this.close();
    }
  }

  on(event: "close", listener: () => void): void {
    if (event === "close") {
      this.closeListeners.add(listener);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    for (const listener of this.closeListeners) {
      listener();
    }
  }
}

function createSnapshot(selfParticipantId: string, revision = 0): RoomSnapshot {
  return {
    roomId: "room-1",
    revision,
    phase: "voting",
    selfParticipantId,
    participants: [
      {
        id: "p1",
        displayName: "Alex",
        hasVoted: false,
      },
      {
        id: "p2",
        displayName: "Sam",
        hasVoted: true,
      },
    ],
  };
}

describe("SseHub", () => {
  it("frames the initial snapshot as a single SSE event with one JSON data line", () => {
    const hub = new SseHub();
    const sink = new FakeSink();
    const snapshot = createSnapshot("p1", 3);

    hub.connect("room-1", "p1", sink, snapshot);

    expect(sink.writes).toEqual([
      `event: snapshot\ndata: ${JSON.stringify(encodeSnapshot(snapshot))}\n\n`,
    ]);
  });

  it("publishes personalized snapshots for each participant", () => {
    const hub = new SseHub();
    const firstSink = new FakeSink();
    const secondSink = new FakeSink();
    hub.connect("room-1", "p1", firstSink, createSnapshot("p1"));
    hub.connect("room-1", "p2", secondSink, createSnapshot("p2"));

    hub.publishRoom("room-1", (participantId) => createSnapshot(participantId, 4));

    expect(firstSink.writes[1]).toBe(
      `event: snapshot\ndata: ${JSON.stringify(encodeSnapshot(createSnapshot("p1", 4)))}\n\n`,
    );
    expect(secondSink.writes[1]).toBe(
      `event: snapshot\ndata: ${JSON.stringify(encodeSnapshot(createSnapshot("p2", 4)))}\n\n`,
    );
  });

  it("writes the exact heartbeat frame to every open stream", () => {
    const hub = new SseHub();
    const firstSink = new FakeSink();
    const secondSink = new FakeSink();
    hub.connect("room-1", "p1", firstSink, createSnapshot("p1"));
    hub.connect("room-2", "p2", secondSink, createSnapshot("p2"));

    hub.heartbeat();

    expect(firstSink.writes.at(-1)).toBe(": ping\n\n");
    expect(secondSink.writes.at(-1)).toBe(": ping\n\n");
  });

  it("rejects the 101st connection with service unavailable", () => {
    const hub = new SseHub();

    for (let index = 0; index < 100; index += 1) {
      hub.connect(`room-${index}`, `p${index}`, new FakeSink(), createSnapshot(`p${index}`));
    }

    const overflowSink = new FakeSink();

    expect(() => hub.connect("overflow", "p101", overflowSink, createSnapshot("p101"))).toThrowError(
      expect.objectContaining({ code: "SERVICE_UNAVAILABLE" }),
    );
    expect(overflowSink.writes).toEqual([]);
  });

  it("does not undercount capacity when end triggers the close listener", () => {
    const hub = new SseHub();
    const expiringSink = new FakeSink({ emitCloseOnEnd: true });
    hub.connect("expiring-room", "p-expiring", expiringSink, createSnapshot("p-expiring"));

    for (let index = 0; index < 99; index += 1) {
      hub.connect(`room-${index}`, `p${index}`, new FakeSink(), createSnapshot(`p${index}`));
    }

    hub.closeRoom("expiring-room");
    hub.connect("replacement-room", "p-replacement", new FakeSink(), createSnapshot("p-replacement"));

    const overflowSink = new FakeSink();

    expect(() => hub.connect("overflow", "p-overflow", overflowSink, createSnapshot("p-overflow"))).toThrowError(
      expect.objectContaining({ code: "SERVICE_UNAVAILABLE" }),
    );
    expect(overflowSink.writes).toEqual([]);
  });

  it("removes clients when their stream closes and keeps cleanup idempotent", () => {
    const hub = new SseHub();
    const sink = new FakeSink();
    const cleanup = hub.connect("room-1", "p1", sink, createSnapshot("p1"));

    sink.close();
    cleanup();
    cleanup();
    hub.publishRoom("room-1", (participantId) => createSnapshot(participantId, 7));
    hub.heartbeat();

    expect(sink.writes).toHaveLength(1);
    expect(sink.endCalls).toBe(0);
  });

  it("emits room-expired before ending every sink in a room", () => {
    const hub = new SseHub();
    const firstSink = new FakeSink();
    const secondSink = new FakeSink();
    const otherRoomSink = new FakeSink();
    hub.connect("room-1", "p1", firstSink, createSnapshot("p1"));
    hub.connect("room-1", "p2", secondSink, createSnapshot("p2"));
    hub.connect("room-2", "p3", otherRoomSink, createSnapshot("p3"));

    hub.closeRoom("room-1");

    expect(firstSink.writes.at(-1)).toBe("event: room-expired\n\n");
    expect(secondSink.writes.at(-1)).toBe("event: room-expired\n\n");
    expect(firstSink.endCalls).toBe(1);
    expect(secondSink.endCalls).toBe(1);
    expect(otherRoomSink.endCalls).toBe(0);
  });

  it("ends every open sink when closing all rooms", () => {
    const hub = new SseHub();
    const firstSink = new FakeSink();
    const secondSink = new FakeSink();
    hub.connect("room-1", "p1", firstSink, createSnapshot("p1"));
    hub.connect("room-2", "p2", secondSink, createSnapshot("p2"));

    hub.closeAll();

    expect(firstSink.endCalls).toBe(1);
    expect(secondSink.endCalls).toBe(1);
  });
});
