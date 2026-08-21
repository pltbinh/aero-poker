import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomSnapshot } from "@scrum-poker/protocol";
import { RoomApiError, type RoomApi } from "../src/api/room-api.js";
import type { RoomCredentialStore, RoomCredentials } from "../src/auth/room-credentials.js";
import type { UseRoomConnectionResult } from "../src/room/use-room-connection.js";
import { AppShell } from "../src/components/app-shell.js";
import { RoomPage } from "../src/pages/room-page.js";

function createApi(): RoomApi {
  return {
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    createStreamTicket: vi.fn(),
    vote: vi.fn().mockResolvedValue(undefined),
    reveal: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}

function createCredentials(loaded: RoomCredentials | null): RoomCredentialStore {
  return {
    load: vi.fn(() => loaded),
    loadDisplayName: vi.fn(() => null),
    save: vi.fn(),
    saveDisplayName: vi.fn(),
    remove: vi.fn(),
  };
}

function createConnection(snapshot: RoomSnapshot, overrides: Partial<UseRoomConnectionResult> = {}): UseRoomConnectionResult {
  return {
    snapshot,
    status: "connected",
    lastError: null,
    reconnect: vi.fn(),
    ...overrides,
  };
}

function votingSnapshot(): RoomSnapshot {
  return {
    roomId: "room-1",
    revision: 1,
    phase: "voting",
    selfParticipantId: "alex",
    participants: [
      { id: "alex", displayName: "Alex", hasVoted: false },
      { id: "sam", displayName: "Sam", hasVoted: true },
      { id: "pat", displayName: "Pat", hasVoted: false },
    ],
  };
}

function revealedSnapshot(): RoomSnapshot {
  return {
    roomId: "room-1",
    revision: 2,
    phase: "revealed",
    selfParticipantId: "alex",
    participants: [
      { id: "alex", displayName: "Alex", hasVoted: true, vote: "5" },
      { id: "sam", displayName: "Sam", hasVoted: true, vote: "8" },
      { id: "pat", displayName: "Pat", hasVoted: true, vote: "8" },
    ],
  };
}

function renderRoomPage(options: {
  roomId?: string;
  credentials?: RoomCredentialStore;
  api?: RoomApi;
  navigate?: (path: string) => void;
  connection?: UseRoomConnectionResult;
  useConnection?: (result: {
    roomId: string;
    participantToken: string;
    api: Pick<RoomApi, "createStreamTicket">;
    apiBaseUrl: string;
  }) => UseRoomConnectionResult;
  clipboard?: Pick<Clipboard, "writeText">;
  apiBaseUrl?: string;
  shareOrigin?: string;
  shareBasePath?: string;
}) {
  const api = options.api ?? createApi();
  const credentials = options.credentials ?? createCredentials({
    participantToken: "participant-token",
    facilitatorToken: "facilitator-token",
  });
  const useConnection =
    options.useConnection ??
    vi.fn(() => options.connection ?? createConnection(votingSnapshot()));

  return {
    api,
    credentials,
    useConnection,
    navigate: options.navigate ?? vi.fn(),
    ...render(
      <AppShell>
        <RoomPage
          api={api}
          apiBaseUrl={options.apiBaseUrl ?? "https://api.example"}
          clipboard={options.clipboard}
          credentials={credentials}
          navigate={options.navigate ?? vi.fn()}
          roomId={options.roomId ?? "room-1"}
          shareBasePath={options.shareBasePath ?? "/scrum-poker/"}
          shareOrigin={options.shareOrigin ?? "https://planning.example"}
          useConnection={useConnection}
        />
      </AppShell>,
    ),
  };
}

afterEach(() => {
  cleanup();
});

describe("RoomPage", () => {
  it("places compact room actions in the navigation and omits the room identity panel", () => {
    renderRoomPage({
      connection: createConnection(votingSnapshot()),
    });

    const navigation = screen.getByRole("banner");
    expect(within(navigation).getByText(/^aero poker$/i)).toBeVisible();
    expect(within(navigation).getByRole("button", { name: /^share$/i })).toBeVisible();
    expect(within(navigation).getByText(/^connected$/i)).toBeVisible();
    expect(screen.queryByText(/^voting room$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^room room-1$/i })).not.toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("heading", { name: /vote deck/i })).toBeVisible();
    expect(screen.queryByText(/room snapshot remains authoritative/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/during voting.*participant/i)).not.toBeInTheDocument();
  });

  it("shows the join form for shared rooms when this browser has no stored credentials", async () => {
    const useConnection = vi.fn();

    renderRoomPage({
      credentials: createCredentials(null),
      roomId: "room-restore",
      useConnection,
    });

    expect(await screen.findByRole("heading", { name: /ready to play/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toHaveValue("room-restore");
    expect(useConnection).not.toHaveBeenCalled();
  });

  it("shows waiting and voted status without rendering hidden vote values before reveal", () => {
    renderRoomPage({
      connection: createConnection(votingSnapshot()),
    });

    const participantList = screen.getByRole("list", { name: /participants/i });

    expect(within(participantList).getByText("Sam")).toBeVisible();
    expect(within(participantList).getByText(/voted/i)).toBeVisible();
    expect(within(participantList).getAllByText(/waiting/i)).toHaveLength(2);
    expect(within(participantList).queryByText("8")).not.toBeInTheDocument();
  });

  it("does not render facilitator controls without the facilitator token", () => {
    renderRoomPage({
      connection: createConnection(votingSnapshot()),
      credentials: createCredentials({
        participantToken: "participant-token",
      }),
    });

    expect(screen.queryByRole("button", { name: /reveal votes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reset round/i })).not.toBeInTheDocument();
  });

  it("copies a share link with only the base path and room hash", async () => {
    const user = userEvent.setup();
    const clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };

    renderRoomPage({
      clipboard,
      connection: createConnection(votingSnapshot()),
    });

    await user.click(screen.getByRole("button", { name: /^share$/i }));

    expect(clipboard.writeText).toHaveBeenCalledWith("https://planning.example/scrum-poker/#/room/room-1");
    expect(clipboard.writeText.mock.calls[0]?.[0]).not.toContain("participant-token");
    expect(clipboard.writeText.mock.calls[0]?.[0]).not.toContain("facilitator-token");
    expect(await screen.findByRole("status")).toHaveTextContent(/invite link copied.*send it to your crew/i);
    expect(within(screen.getByRole("banner")).queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders textual offline connection status and a reconnect action", async () => {
    const user = userEvent.setup();
    const reconnect = vi.fn();

    renderRoomPage({
      connection: createConnection(votingSnapshot(), {
        status: "offline",
        lastError: new Error("connection dropped"),
        reconnect,
      }),
    });

    expect(screen.getByText(/offline/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /reconnect/i }));

    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("removes stored credentials and offers a path back when the room expires", async () => {
    const user = userEvent.setup();
    const credentials = createCredentials({
      participantToken: "participant-token",
      facilitatorToken: "facilitator-token",
    });
    const navigate = vi.fn();

    renderRoomPage({
      connection: createConnection(votingSnapshot(), {
        status: "expired",
        lastError: new Error("room expired"),
      }),
      credentials,
      navigate,
    });

    await waitFor(() => {
      expect(credentials.remove).toHaveBeenCalledWith("room-1");
    });

    expect(screen.getByRole("heading", { name: /room expired/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back to landing page/i }));

    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("calls reveal and reset with the participant and facilitator tokens", async () => {
    const user = userEvent.setup();
    const api = createApi();

    renderRoomPage({
      api,
      connection: createConnection(votingSnapshot()),
    });

    await user.click(screen.getByRole("button", { name: /reveal votes/i }));

    expect(api.reveal).toHaveBeenCalledWith("room-1", "participant-token", "facilitator-token");

    cleanup();

    renderRoomPage({
      api,
      connection: createConnection(revealedSnapshot()),
    });

    await user.click(screen.getByRole("button", { name: /reset round/i }));

    expect(api.reset).toHaveBeenCalledWith("room-1", "participant-token", "facilitator-token");
  });

  it.each(["vote", "reveal", "reset"] as const)(
    "clears stored credentials when the %s action reports ROOM_NOT_FOUND",
    async (action) => {
      const user = userEvent.setup();
      const credentials = createCredentials({
        participantToken: "participant-token",
        facilitatorToken: "facilitator-token",
      });
      const api = createApi();
      const error = new RoomApiError("ROOM_NOT_FOUND", 404, "That room no longer exists.");

      if (action === "vote") {
        api.vote = vi.fn().mockRejectedValue(error);
      } else if (action === "reveal") {
        api.reveal = vi.fn().mockRejectedValue(error);
      } else {
        api.reset = vi.fn().mockRejectedValue(error);
      }

      renderRoomPage({
        api,
        credentials,
        connection: createConnection(action === "reset" ? revealedSnapshot() : votingSnapshot()),
      });

      if (action === "vote") {
        await user.click(screen.getByRole("button", { name: "8" }));
      } else if (action === "reveal") {
        await user.click(screen.getByRole("button", { name: /reveal votes/i }));
      } else {
        await user.click(screen.getByRole("button", { name: /reset round/i }));
      }

      await waitFor(() => {
        expect(credentials.remove).toHaveBeenCalledWith("room-1");
      });
      expect(screen.getByRole("heading", { name: /room expired/i })).toBeInTheDocument();
    },
  );
});
