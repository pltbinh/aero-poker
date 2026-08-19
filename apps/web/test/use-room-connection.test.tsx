import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeSnapshot, type RoomSnapshot } from "@scrum-poker/protocol";

function snapshotAt(revision: number): RoomSnapshot {
  return {
    roomId: "room-1",
    revision,
    phase: revision >= 2 ? "revealed" : "voting",
    selfParticipantId: "participant-1",
    participants: [
      {
        id: "participant-1",
        displayName: "Alex",
        hasVoted: revision >= 1,
        ...(revision >= 2 ? { vote: "5" as const } : {}),
      },
      {
        id: "participant-2",
        displayName: "Sam",
        hasVoted: revision >= 1,
        ...(revision >= 2 ? { vote: "8" as const } : {}),
      },
    ],
  };
}

class FakeVisibilityDocument {
  visibilityState: "visible" | "hidden" = "visible";

  private readonly listeners = new Set<() => void>();

  addEventListener(event: string, listener: EventListener): void {
    if (event === "visibilitychange") {
      this.listeners.add(listener as () => void);
    }
  }

  removeEventListener(event: string, listener: EventListener): void {
    if (event === "visibilitychange") {
      this.listeners.delete(listener as () => void);
    }
  }

  setVisibility(next: "visible" | "hidden"): void {
    this.visibilityState = next;

    for (const listener of this.listeners) {
      listener();
    }
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, Set<(event: { data: string }) => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: { data: string }) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: { data: string }) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  emitSnapshot(snapshot: RoomSnapshot): void {
    const payload = JSON.stringify(encodeSnapshot(snapshot));

    for (const listener of this.listeners.get("snapshot") ?? []) {
      listener({ data: payload });
    }
  }

  emitError(message = "stream failed"): void {
    for (const listener of this.listeners.get("error") ?? []) {
      listener({ data: message });
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function mountHook(options: {
  roomId: string;
  participantToken: string;
  api: {
    createStreamTicket: (roomId: string, participantToken: string) => Promise<string>;
  };
  apiBaseUrl: string;
  random?: () => number;
  visibilityDocument?: FakeVisibilityDocument;
  eventSourceFactory?: (url: string) => FakeEventSource;
}) {
  const React = await import("react");
  const { useRoomConnection } = await import("../src/room/use-room-connection.js");
  const { createRoot } = await import("react-dom/client");
  const { act } = React;
  let latest:
    | {
        snapshot: RoomSnapshot | null;
        status: "connecting" | "connected" | "reconnecting" | "offline" | "expired";
        lastError: unknown;
        reconnect: () => void;
      }
    | undefined;
  const container = document.createElement("div");
  const root = createRoot(container);

  function TestComponent() {
    latest = useRoomConnection(options);
    return null;
  }

  document.body.appendChild(container);

  await act(async () => {
    root.render(React.createElement(TestComponent));
    await flushMicrotasks();
  });

  return {
    run: async (effect: () => void | Promise<void>) => {
      await act(async () => {
        await effect();
        await flushMicrotasks();
      });
    },
    current: () => {
      if (latest === undefined) {
        throw new Error("Expected hook state");
      }

      return latest;
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
        await flushMicrotasks();
      });
      container.remove();
    },
  };
}

describe("useRoomConnection", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    vi.useRealTimers();
  });

  it("opens a ticket-backed EventSource, decodes snapshots, closes when hidden, and reconnects with a fresh ticket when visible again", async () => {
    const visibilityDocument = new FakeVisibilityDocument();
    const api = {
      createStreamTicket: vi
        .fn<(_: string, __: string) => Promise<string>>()
        .mockResolvedValueOnce("ticket-1")
        .mockResolvedValueOnce("ticket-2"),
    };
    const hook = await mountHook({
      roomId: "room-1",
      participantToken: "participant-token",
      api,
      apiBaseUrl: "https://api.example",
      visibilityDocument,
      eventSourceFactory: (url) => new FakeEventSource(url),
    });

    await flushMicrotasks();

    expect(api.createStreamTicket).toHaveBeenCalledWith("room-1", "participant-token");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe(
      "https://api.example/api/rooms/room-1/stream?ticket=ticket-1",
    );

    await hook.run(() => {
      FakeEventSource.instances[0]?.emitSnapshot(snapshotAt(1));
    });

    expect(hook.current()).toEqual({
      snapshot: snapshotAt(1),
      status: "connected",
      lastError: null,
      reconnect: expect.any(Function),
    });

    await hook.run(() => {
      visibilityDocument.setVisibility("hidden");
    });

    expect(FakeEventSource.instances[0]?.closed).toBe(true);

    await hook.run(() => {
      visibilityDocument.setVisibility("visible");
    });

    expect(api.createStreamTicket).toHaveBeenCalledTimes(2);
    expect(FakeEventSource.instances[1]?.url).toBe(
      "https://api.example/api/rooms/room-1/stream?ticket=ticket-2",
    );

    await hook.run(() => {
      FakeEventSource.instances[1]?.emitSnapshot(snapshotAt(2));
    });

    expect(hook.current().snapshot).toEqual(snapshotAt(2));

    await hook.unmount();
  });

  it("preserves the last snapshot while reconnecting and retries with full jitter from a one-second base delay", async () => {
    const visibilityDocument = new FakeVisibilityDocument();
    const api = {
      createStreamTicket: vi
        .fn<(_: string, __: string) => Promise<string>>()
        .mockResolvedValueOnce("ticket-1")
        .mockResolvedValueOnce("ticket-2"),
    };
    const hook = await mountHook({
      roomId: "room-1",
      participantToken: "participant-token",
      api,
      apiBaseUrl: "https://api.example",
      visibilityDocument,
      eventSourceFactory: (url) => new FakeEventSource(url),
      random: () => 0.5,
    });

    await hook.run(() => {
      FakeEventSource.instances[0]?.emitSnapshot(snapshotAt(3));
    });

    await hook.run(() => {
      FakeEventSource.instances[0]?.emitError();
    });

    expect(hook.current().status).toBe("reconnecting");
    expect(hook.current().snapshot).toEqual(snapshotAt(3));

    await hook.run(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(api.createStreamTicket).toHaveBeenCalledTimes(1);

    await hook.run(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(api.createStreamTicket).toHaveBeenCalledTimes(2);
    expect(FakeEventSource.instances[1]?.url).toBe(
      "https://api.example/api/rooms/room-1/stream?ticket=ticket-2",
    );

    await hook.unmount();
  });

  it("caps reconnect delay at thirty seconds", async () => {
    const tickets = Array.from({ length: 8 }, (_, index) => `ticket-${index + 1}`);
    const api = {
      createStreamTicket: vi.fn(async () => {
        const ticket = tickets.shift();

        if (ticket === undefined) {
          throw new Error("missing test ticket");
        }

        return ticket;
      }),
    };
    const hook = await mountHook({
      roomId: "room-1",
      participantToken: "participant-token",
      api,
      apiBaseUrl: "https://api.example",
      visibilityDocument: new FakeVisibilityDocument(),
      eventSourceFactory: (url) => new FakeEventSource(url),
      random: () => 1,
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await hook.run(() => {
        FakeEventSource.instances[attempt]?.emitError();
      });
      await hook.run(async () => {
        await vi.advanceTimersByTimeAsync(2 ** attempt * 1000);
      });
    }

    await hook.run(() => {
      FakeEventSource.instances[5]?.emitError();
    });

    await hook.run(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(api.createStreamTicket).toHaveBeenCalledTimes(6);

    await hook.run(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(api.createStreamTicket).toHaveBeenCalledTimes(7);

    await hook.unmount();
  });
});
