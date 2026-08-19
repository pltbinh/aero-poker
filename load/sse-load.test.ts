import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app.ts";
import { RoomStore } from "../apps/server/src/rooms/room-store.ts";
import { StreamTicketStore } from "../apps/server/src/streams/stream-tickets.ts";
import { SseHub } from "../apps/server/src/streams/sse-hub.ts";
import { evaluateLoadResult, parseLoadOptions, runLoadCheck } from "./sse-load.ts";

interface DisposableContext {
  close: () => Promise<void>;
}

const disposables = new Set<DisposableContext>();

afterEach(async () => {
  for (const disposable of disposables) {
    await disposable.close();
    disposables.delete(disposable);
  }
});

async function createTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "scrum-poker-load-"));
  const app = createApp({
    config: {
      corsOrigins: [],
      egressDisabledFile: path.join(tempDir, "egress-disabled"),
      host: "127.0.0.1",
      nodeEnv: "production",
      port: 0,
    },
    hub: new SseHub(),
    logger: {
      error: () => undefined,
      info: () => undefined,
    },
    rooms: new RoomStore(),
    tickets: new StreamTicketStore(),
  });
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an IPv4 address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await rm(tempDir, { force: true, recursive: true });
    },
  };
}

describe("parseLoadOptions", () => {
  it("requires an explicit base URL and applies the Task 9 defaults", () => {
    expect(
      parseLoadOptions(["--base-url=http://127.0.0.1:4100"]),
    ).toEqual({
      allowedUnexpectedDisconnects: 0,
      baseUrl: "http://127.0.0.1:4100",
      durationSeconds: 300,
      expectedClients: 100,
      participantsPerRoom: 20,
      rooms: 5,
      rssCeilingMiB: 220,
    });
  });

  it("accepts the split base-url form", () => {
    expect(
      parseLoadOptions(["--base-url", "http://localhost:4100", "--duration-seconds=30"]),
    ).toMatchObject({
      baseUrl: "http://localhost:4100",
      durationSeconds: 30,
    });
  });

  it("ignores the pnpm double-dash separator", () => {
    expect(
      parseLoadOptions(["--", "--base-url=http://127.0.0.1:4100", "--duration-seconds=30"]),
    ).toMatchObject({
      baseUrl: "http://127.0.0.1:4100",
      durationSeconds: 30,
    });
  });

  it("rejects a missing base URL", () => {
    expect(() => parseLoadOptions([])).toThrow(/base-url/i);
  });

  it("rejects malformed base URLs", () => {
    expect(() => parseLoadOptions(["--base-url=not-a-url"])).toThrow(/valid http/i);
  });

  it("rejects production-looking base URLs", () => {
    expect(() => parseLoadOptions(["--base-url=https://poker-api.keothom24.com"])).toThrow(
      /production/i,
    );
  });

  it("rejects non-positive integers and the wrong client relationship", () => {
    expect(() => parseLoadOptions(["--base-url=http://127.0.0.1:4100", "--rooms=0"])).toThrow(
      /positive integer/i,
    );
    expect(
      () =>
        parseLoadOptions([
          "--base-url=http://127.0.0.1:4100",
          "--rooms=4",
          "--participants-per-room=20",
        ]),
    ).toThrow(/100 clients/i);
  });
});

describe("evaluateLoadResult", () => {
  it("passes when all Task 9 gates are satisfied", () => {
    expect(
      evaluateLoadResult({
        completedRooms: 5,
        connectedClients: 100,
        durationMs: 300_000,
        expectedClients: 100,
        initialSnapshots: 100,
        receivedBytes: 12_345,
        roomsAttempted: 5,
        rssMiB: 180,
        unexpectedDisconnects: 0,
      }),
    ).toEqual({
      metrics: {
        completedRooms: 5,
        connectedClients: 100,
        durationMs: 300_000,
        expectedClients: 100,
        initialSnapshots: 100,
        receivedBytes: 12_345,
        roomsAttempted: 5,
        rssMiB: 180,
        unexpectedDisconnects: 0,
      },
      ok: true,
      reasons: [],
    });
  });

  it("fails with actionable reasons for unmet gates", () => {
    expect(
      evaluateLoadResult({
        completedRooms: 4,
        connectedClients: 96,
        durationMs: 29_000,
        expectedClients: 100,
        initialSnapshots: 95,
        receivedBytes: 9_000,
        roomsAttempted: 5,
        rssMiB: 230,
        unexpectedDisconnects: 2,
      }),
    ).toEqual({
      metrics: {
        completedRooms: 4,
        connectedClients: 96,
        durationMs: 29_000,
        expectedClients: 100,
        initialSnapshots: 95,
        receivedBytes: 9_000,
        roomsAttempted: 5,
        rssMiB: 230,
        unexpectedDisconnects: 2,
      },
      ok: false,
      reasons: [
        "Expected 100 connected clients but observed 96.",
        "Expected 100 initial snapshots but observed 95.",
        "Expected 5 completed rooms but observed 4.",
        "Expected 0 unexpected disconnects but observed 2.",
        "Observed RSS 230 MiB exceeds the 220 MiB ceiling.",
      ],
    });
  });
});

describe("runLoadCheck", () => {
  it(
    "exercises the public HTTP and SSE API for the required 100-client load shape",
    async () => {
      const server = await createTestServer();
      disposables.add(server);
      const infoLines: string[] = [];
      const errorLines: string[] = [];

      const result = await runLoadCheck(
        {
          ...parseLoadOptions(["--base-url", server.baseUrl, "--duration-seconds=1"]),
          durationSeconds: 1,
        },
        {
          logger: {
            error: (message: string) => {
              errorLines.push(message);
            },
            info: (message: string) => {
              infoLines.push(message);
            },
          },
        },
      );

      expect(result).toMatchObject({
        completedRooms: 5,
        connectedClients: 100,
        expectedClients: 100,
        initialSnapshots: 100,
        roomsAttempted: 5,
        unexpectedDisconnects: 0,
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(1_000);
      expect(result.receivedBytes).toBeGreaterThan(0);
      expect(evaluateLoadResult(result).ok).toBe(true);

      const combinedLogs = [...infoLines, ...errorLines].join("\n");
      expect(combinedLogs).not.toContain("Bearer ");
      expect(combinedLogs).not.toContain("ticket=");
      expect(combinedLogs).not.toContain("facilitatorToken");
      expect(combinedLogs).not.toContain("participantToken");
    },
    60_000,
  );
});
