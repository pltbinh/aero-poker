import { describe, expect, it } from "vitest";
import { StreamTicketStore } from "../src/streams/stream-tickets.js";

function createClock(start = 0) {
  let current = start;

  return {
    now: () => current,
    advanceBy: (ms: number) => {
      current += ms;
    },
  };
}

describe("StreamTicketStore", () => {
  it("consumes a ticket exactly once within 30 seconds", () => {
    const clock = createClock();
    const tickets = new StreamTicketStore({ now: clock.now });
    const ticket = tickets.issue("room-1", "p1");

    expect(tickets.consume("room-1", ticket)).toEqual({ participantId: "p1" });
    expect(() => tickets.consume("room-1", ticket)).toThrowError(
      expect.objectContaining({ code: "STREAM_TICKET_INVALID" }),
    );
  });

  it("rejects tickets after 30 seconds", () => {
    const clock = createClock();
    const tickets = new StreamTicketStore({ now: clock.now });
    const ticket = tickets.issue("room-1", "p1");

    clock.advanceBy(30_001);

    expect(() => tickets.consume("room-1", ticket)).toThrowError(
      expect.objectContaining({ code: "STREAM_TICKET_EXPIRED" }),
    );
  });

  it("sweeps expired tickets without removing active ones", () => {
    const clock = createClock();
    const tickets = new StreamTicketStore({ now: clock.now });
    tickets.issue("room-1", "p1");

    clock.advanceBy(29_000);

    const activeTicket = tickets.issue("room-1", "p2");

    clock.advanceBy(2_000);

    expect(tickets.sweepExpired()).toBe(1);
    expect(tickets.consume("room-1", activeTicket)).toEqual({ participantId: "p2" });
  });
});
