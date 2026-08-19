import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { RoomStore } from "./rooms/room-store.js";
import { StreamTicketStore } from "./streams/stream-tickets.js";
import { SseHub } from "./streams/sse-hub.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const CLEANUP_INTERVAL_MS = 5 * 60_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

interface LoggerLike {
  error(message: string): void;
}

export interface RunningServer {
  host: string;
  port: number;
  url: string;
  shutdown: () => Promise<void>;
  closed: Promise<void>;
}

export async function startServer(config: AppConfig): Promise<RunningServer> {
  const rooms = new RoomStore();
  const tickets = new StreamTicketStore();
  const hub = new SseHub();
  const sockets = new Set<Socket>();
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const readiness = {
    isReady: () => !shuttingDown && !existsSync(config.egressDisabledFile),
  };
  const app = createApp({
    config,
    rooms,
    tickets,
    hub,
    readiness,
  });
  const server = createServer(app);

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const heartbeatTimer = setInterval(() => {
    hub.heartbeat();
  }, HEARTBEAT_INTERVAL_MS);
  const cleanupTimer = setInterval(() => {
    const expiredRoomIds = rooms.sweepExpired();

    for (const roomId of expiredRoomIds) {
      hub.closeRoom(roomId);
    }

    tickets.sweepExpired();
  }, CLEANUP_INTERVAL_MS);

  heartbeatTimer.unref();
  cleanupTimer.unref();

  const stopSignals = () => {
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
  };

  const shutdown = async (): Promise<void> => {
    if (shutdownPromise !== undefined) {
      return shutdownPromise;
    }

    shuttingDown = true;
    clearInterval(heartbeatTimer);
    clearInterval(cleanupTimer);
    stopSignals();
    hub.closeAll();

    shutdownPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const forceTimer = setTimeout(() => {
        for (const socket of sockets) {
          socket.destroy();
        }

        process.exitCode = 1;
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);

      const finish = (error?: Error | null) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(forceTimer);

        if (error) {
          reject(error);
          return;
        }

        resolve();
      };

      server.close((error) => {
        finish(error);
      });
    }).finally(() => {
      resolveClosed();
    });

    return shutdownPromise;
  };

  const onSigterm = () => {
    void shutdown();
  };
  const onSigint = () => {
    void shutdown();
  };

  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);

  const address = server.address();

  if (address === null || typeof address === "string") {
    await shutdown();
    throw new Error("Server did not bind to an IPv4 port");
  }

  return {
    host: config.host,
    port: address.port,
    url: `http://${config.host}:${address.port}`,
    shutdown,
    closed,
  };
}

interface RunServerMainOptions {
  loadConfig?: () => AppConfig;
  startServer?: (config: AppConfig) => Promise<RunningServer>;
  logger?: LoggerLike;
  exit?: (code: number) => void;
}

function startupFailureMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return `Server startup failed [${error.code}].`;
  }

  return "Server startup failed.";
}

export async function runServerMain(options: RunServerMainOptions = {}): Promise<void> {
  const {
    loadConfig: loadConfigImpl = loadConfig,
    startServer: startServerImpl = startServer,
    logger = console,
    exit = (code: number) => {
      process.exit(code);
    },
  } = options;

  try {
    await startServerImpl(loadConfigImpl());
  } catch (error) {
    logger.error(startupFailureMessage(error));
    exit(1);
  }
}

const entrypoint = process.argv[1];
const isMain = entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;

if (isMain) {
  void runServerMain();
}
