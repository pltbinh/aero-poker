import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomApiError, type RoomApi } from "../src/api/room-api.js";
import type { RoomCredentialStore } from "../src/auth/room-credentials.js";
import { LandingPage } from "../src/pages/landing-page.js";

function createApi(): RoomApi {
  return {
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    createStreamTicket: vi.fn(),
    vote: vi.fn(),
    reveal: vi.fn(),
    reset: vi.fn(),
  };
}

function createCredentials(savedDisplayName: string | null = null): RoomCredentialStore {
  return {
    load: vi.fn(() => null),
    loadDisplayName: vi.fn(() => savedDisplayName),
    save: vi.fn(),
    saveDisplayName: vi.fn(),
    remove: vi.fn(),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
});

describe("LandingPage", () => {
  it("prefills the saved browser name and remembers an edited name on submit", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const credentials = createCredentials("Alex");

    vi.mocked(api.joinRoom).mockResolvedValue({ participantToken: "pt" });

    render(<LandingPage api={api} credentials={credentials} initialRoomId="room-7" navigate={vi.fn()} />);

    const nameInput = screen.getByLabelText(/your name/i);
    expect(nameInput).toHaveValue("Alex");

    await user.clear(nameInput);
    await user.type(nameInput, "  Sam  ");
    await user.click(screen.getByRole("button", { name: /join the game/i }));

    expect(credentials.saveDisplayName).toHaveBeenCalledWith("Sam");
    expect(api.joinRoom).toHaveBeenCalledWith("room-7", "Sam");
  });

  it("shows only the friendly game setup form", () => {
    render(<LandingPage api={createApi()} credentials={createCredentials()} navigate={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /ready to play/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /start a room/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /join the game/i })).toBeVisible();
    expect(screen.queryByText(/keyboard-first/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/shareable hash links/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/heads up/i)).not.toBeInTheDocument();
  });

  it("creates a room and stores both creator credentials", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const credentials = createCredentials();
    const navigate = vi.fn();

    vi.mocked(api.createRoom).mockResolvedValue({
      roomId: "room-1",
      participantToken: "pt",
      facilitatorToken: "ft",
    });

    render(<LandingPage api={api} credentials={credentials} navigate={navigate} />);

    await user.type(screen.getByLabelText(/your name/i), "Alex");
    await user.click(screen.getByRole("button", { name: /start a room/i }));

    expect(api.createRoom).toHaveBeenCalledWith("Alex");
    expect(credentials.save).toHaveBeenCalledWith("room-1", {
      participantToken: "pt",
      facilitatorToken: "ft",
    });
    expect(navigate).toHaveBeenCalledWith("/room/room-1");
  });

  it("joins an existing room and stores the participant credential", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const credentials = createCredentials();
    const navigate = vi.fn();

    vi.mocked(api.joinRoom).mockResolvedValue({
      participantToken: "pt",
    });

    render(<LandingPage api={api} credentials={credentials} navigate={navigate} />);

    await user.type(screen.getByLabelText(/your name/i), "Sam");
    await user.type(screen.getByLabelText(/room code/i), "room-2");
    await user.click(screen.getByRole("button", { name: /join the game/i }));

    expect(api.joinRoom).toHaveBeenCalledWith("room-2", "Sam");
    expect(credentials.save).toHaveBeenCalledWith("room-2", {
      participantToken: "pt",
    });
    expect(navigate).toHaveBeenCalledWith("/room/room-2");
  });

  it("validates a trimmed display name before creating or joining", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const credentials = createCredentials();
    const navigate = vi.fn();

    render(<LandingPage api={api} credentials={credentials} navigate={navigate} />);

    await user.type(screen.getByLabelText(/your name/i), "   ");
    await user.click(screen.getByRole("button", { name: /start a room/i }));

    expect(screen.getByText(/enter your name to jump in/i)).toBeInTheDocument();
    expect(api.createRoom).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/your name/i));
    await user.type(screen.getByLabelText(/your name/i), "  Alex  ");
    await user.type(screen.getByLabelText(/room code/i), "  room-3  ");
    vi.mocked(api.joinRoom).mockResolvedValue({
      participantToken: "participant-token",
    });

    await user.click(screen.getByRole("button", { name: /join the game/i }));

    expect(api.joinRoom).toHaveBeenCalledWith("room-3", "Alex");
    expect(credentials.save).toHaveBeenCalledWith("room-3", {
      participantToken: "participant-token",
    });
    expect(navigate).toHaveBeenCalledWith("/room/room-3");
  });

  it("rejects a trimmed display name longer than thirty characters before calling the API", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const credentials = createCredentials();
    const navigate = vi.fn();

    render(<LandingPage api={api} credentials={credentials} navigate={navigate} />);

    await user.type(screen.getByLabelText(/your name/i), `  ${"A".repeat(31)}  `);
    await user.click(screen.getByRole("button", { name: /start a room/i }));

    expect(screen.getByText(/keep your name under 30 characters/i)).toBeInTheDocument();
    expect(api.createRoom).not.toHaveBeenCalled();
    expect(credentials.save).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows friendly API error text without navigating away", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const credentials = createCredentials();
    const navigate = vi.fn();

    vi.mocked(api.joinRoom).mockRejectedValue(
      new RoomApiError("ROOM_NOT_FOUND", 404, "That room code was not found."),
    );

    render(<LandingPage api={api} credentials={credentials} navigate={navigate} />);

    await user.type(screen.getByLabelText(/your name/i), "Sam");
    await user.type(screen.getByLabelText(/room code/i), "missing-room");
    await user.click(screen.getByRole("button", { name: /join the game/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/that room code was not found/i);
    expect(credentials.save).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("uses the transient toast path for system errors", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const credentials = createCredentials();
    const navigate = vi.fn();

    vi.mocked(api.createRoom).mockRejectedValue(new Error("upstream offline"));

    render(<LandingPage api={api} credentials={credentials} navigate={navigate} />);

    await user.type(screen.getByLabelText(/your name/i), "Alex");
    await user.click(screen.getByRole("button", { name: /start a room/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/quick breather/i);
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(
      () => {
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      },
      {
        timeout: 3_000,
      },
    );
  });

  it("disables controls while a create request is pending", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const credentials = createCredentials();
    const navigate = vi.fn();
    const deferred = createDeferred<Awaited<ReturnType<RoomApi["createRoom"]>>>();

    vi.mocked(api.createRoom).mockReturnValue(deferred.promise);

    render(<LandingPage api={api} credentials={credentials} navigate={navigate} />);

    await user.type(screen.getByLabelText(/your name/i), "Alex");
    await user.click(screen.getByRole("button", { name: /start a room/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/your name/i)).toBeDisabled();
    });

    expect(screen.getByLabelText(/room code/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /start a room/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /join the game/i })).toBeDisabled();

    deferred.resolve({
      roomId: "room-4",
      participantToken: "pt",
      facilitatorToken: "ft",
    });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/room/room-4");
    });
  });

  it("submits the join action when Enter is pressed in the room code field", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const credentials = createCredentials();
    const navigate = vi.fn();

    vi.mocked(api.joinRoom).mockResolvedValue({
      participantToken: "pt",
    });

    render(<LandingPage api={api} credentials={credentials} navigate={navigate} />);

    await user.type(screen.getByLabelText(/your name/i), "Sam");
    await user.type(screen.getByLabelText(/room code/i), "room-enter{Enter}");

    expect(api.joinRoom).toHaveBeenCalledWith("room-enter", "Sam");
    expect(credentials.save).toHaveBeenCalledWith("room-enter", {
      participantToken: "pt",
    });
    expect(navigate).toHaveBeenCalledWith("/room/room-enter");
  });

  it("updates the seeded room code only when the user has not edited away from it", async () => {
    const api = createApi();
    const credentials = createCredentials();
    const navigate = vi.fn();
    const { rerender } = render(
      <LandingPage api={api} credentials={credentials} initialRoomId="room-a" navigate={navigate} />,
    );

    const roomCodeInput = screen.getByLabelText(/room code/i);
    expect(roomCodeInput).toHaveValue("room-a");

    rerender(<LandingPage api={api} credentials={credentials} initialRoomId="room-b" navigate={navigate} />);
    expect(roomCodeInput).toHaveValue("room-b");

    await userEvent.clear(roomCodeInput);
    await userEvent.type(roomCodeInput, "custom-room");

    rerender(<LandingPage api={api} credentials={credentials} initialRoomId="room-c" navigate={navigate} />);
    expect(roomCodeInput).toHaveValue("custom-room");
  });
});
