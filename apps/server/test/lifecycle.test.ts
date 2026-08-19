import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomStore } from "../src/rooms/room-store.js";
import { SseHub } from "../src/streams/sse-hub.js";
import { StreamTicketStore } from "../src/streams/stream-tickets.js";
import { startServer } from "../src/index.js";

interface TestConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  corsOrigins: string[];
  egressDisabledFile: string;
}

async function makeConfig(): Promise<{ config: TestConfig; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scrum-poker-task-4-"));
  const egressDisabledFile = path.join(dir, "egress-disabled");

  return {
    config: {
      nodeEnv: "test",
      host: "127.0.0.1",
      port: 0,
      corsOrigins: ["https://allowed.example"],
      egressDisabledFile,
    },
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const cleanups = new Set<() => Promise<void>>();

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();

  for (const cleanup of cleanups) {
    await cleanup();
    cleanups.delete(cleanup);
  }
});

describe("startServer", () => {
  it("schedules heartbeat and cleanup timers and closes expired rooms", async () => {
    vi.useFakeTimers();
    const { config, cleanup } = await makeConfig();
    cleanups.add(cleanup);

    const heartbeatSpy = vi.spyOn(SseHub.prototype, "heartbeat");
    const closeRoomSpy = vi.spyOn(SseHub.prototype, "closeRoom");
    const roomSweepSpy = vi.spyOn(RoomStore.prototype, "sweepExpired").mockReturnValue(["expired-room"]);
    const ticketSweepSpy = vi.spyOn(StreamTicketStore.prototype, "sweepExpired").mockReturnValue(2);

    const running = await startServer(config);
    cleanups.add(() => running.shutdown());

    await vi.advanceTimersByTimeAsync(30_000);
    expect(heartbeatSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(270_000);
    expect(roomSweepSpy).toHaveBeenCalledTimes(1);
    expect(ticketSweepSpy).toHaveBeenCalledTimes(1);
    expect(closeRoomSpy).toHaveBeenCalledWith("expired-room");
  });

  it("handles SIGTERM by becoming unready, closing SSE clients, and shutting down cleanly", async () => {
    const { config, cleanup } = await makeConfig();
    cleanups.add(cleanup);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => code as never) as never);
    const running = await startServer(config);
    cleanups.add(() => running.shutdown());

    const created = await fetch(`${running.url}/api/rooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Alex" }),
    });
    const creator = (await created.json()) as { roomId: string; participantToken: string };
    const ticketResponse = await fetch(`${running.url}/api/rooms/${creator.roomId}/stream-ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creator.participantToken}`,
      },
    });
    const ticket = ((await ticketResponse.json()) as { ticket: string }).ticket;
    const stream = await fetch(`${running.url}/api/rooms/${creator.roomId}/stream?ticket=${ticket}`);

    expect(stream.body).not.toBeNull();

    const reader = stream.body!.getReader();
    await reader.read();

    process.emit("SIGTERM");
    await running.closed;

    const afterSignal = await reader.read();
    expect(afterSignal.done).toBe(true);
    await expect(fetch(`${running.url}/health/live`)).rejects.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("forces a nonzero exit if shutdown cannot close within ten seconds", async () => {
    vi.useFakeTimers();
    const { config, cleanup } = await makeConfig();
    cleanups.add(cleanup);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => code as never) as never);
    const running = await startServer(config);
    cleanups.add(() => running.shutdown());

    const socket = net.createConnection({
      host: running.host,
      port: running.port,
    });
    await once(socket, "connect");

    process.emit("SIGINT");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(exitSpy).toHaveBeenCalledWith(1);

    socket.destroy();
    await running.shutdown();
  });

  it("treats the egress-disabled marker as not ready", async () => {
    const { config, cleanup } = await makeConfig();
    cleanups.add(cleanup);
    await writeFile(config.egressDisabledFile, "disabled", "utf8");

    const running = await startServer(config);
    cleanups.add(() => running.shutdown());

    const response = await fetch(`${running.url}/health/ready`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: expect.any(String),
    });
  });
});
