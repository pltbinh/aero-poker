import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreatedRoomResponse } from "@scrum-poker/protocol";
import { RoomApiError, createRoomApi } from "../src/api/room-api.js";

describe("createRoomApi", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("creates a room with JSON, no credentials, and a ten-second timeout", async () => {
    const api = createRoomApi({ baseUrl: "https://api.example" });
    const signal = new AbortController().signal;
    const created: CreatedRoomResponse = {
      roomId: "room-1",
      participantToken: "participant-token",
      facilitatorToken: "facilitator-token",
    };
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    globalThis.fetch = fetchMock as typeof fetch;

    await expect(api.createRoom("Alex")).resolves.toEqual(created);
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/api/rooms",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        signal,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ displayName: "Alex" }),
      }),
    );
  });

  it("sends bearer and facilitator headers for facilitator-only actions", async () => {
    const api = createRoomApi({ baseUrl: "https://api.example" });
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

    globalThis.fetch = fetchMock as typeof fetch;

    await expect(api.reveal("room-1", "participant-token", "facilitator-token")).resolves.toBeUndefined();
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/api/rooms/room-1/reveal",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        signal,
        headers: {
          authorization: "Bearer participant-token",
          "x-facilitator-token": "facilitator-token",
        },
      }),
    );
  });

  it("returns the stream ticket string from the ticket endpoint", async () => {
    const api = createRoomApi({ baseUrl: "https://api.example" });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ticket: "stream-ticket", expiresInSeconds: 30 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    globalThis.fetch = fetchMock as typeof fetch;

    await expect(api.createStreamTicket("room-1", "participant-token")).resolves.toBe("stream-ticket");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/api/rooms/room-1/stream-ticket",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        headers: {
          authorization: "Bearer participant-token",
        },
      }),
    );
  });

  it("maps stable API errors into RoomApiError", async () => {
    const api = createRoomApi({ baseUrl: "https://api.example" });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ code: "ROOM_FULL", message: "This room already has 20 participants." }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    globalThis.fetch = fetchMock as typeof fetch;

    await expect(api.joinRoom("room-1", "Sam")).rejects.toEqual(
      expect.objectContaining<Partial<RoomApiError>>({
        name: "RoomApiError",
        code: "ROOM_FULL",
        status: 409,
        message: "This room already has 20 participants.",
      }),
    );
  });
});
