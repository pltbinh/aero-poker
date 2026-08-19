import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomApiError, type RoomApi } from "../src/api/room-api.js";
import type { RoomCredentialStore } from "../src/auth/room-credentials.js";
import { LandingPage } from "../src/pages/landing-page.js";

function createApi(): Pick<RoomApi, "createRoom" | "joinRoom"> {
  return {
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
  };
}

function createCredentials(): RoomCredentialStore {
  return {
    load: vi.fn(() => null),
    save: vi.fn(),
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

    await user.type(screen.getByLabelText(/display name/i), "Alex");
    await user.click(screen.getByRole("button", { name: /create room/i }));

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

    await user.type(screen.getByLabelText(/display name/i), "Sam");
    await user.type(screen.getByLabelText(/room code/i), "room-2");
    await user.click(screen.getByRole("button", { name: /join room/i }));

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

    await user.type(screen.getByLabelText(/display name/i), "   ");
    await user.click(screen.getByRole("button", { name: /create room/i }));

    expect(screen.getByText(/enter a display name/i)).toBeInTheDocument();
    expect(api.createRoom).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/display name/i));
    await user.type(screen.getByLabelText(/display name/i), "  Alex  ");
    await user.type(screen.getByLabelText(/room code/i), "  room-3  ");
    vi.mocked(api.joinRoom).mockResolvedValue({
      participantToken: "participant-token",
    });

    await user.click(screen.getByRole("button", { name: /join room/i }));

    expect(api.joinRoom).toHaveBeenCalledWith("room-3", "Alex");
    expect(credentials.save).toHaveBeenCalledWith("room-3", {
      participantToken: "participant-token",
    });
    expect(navigate).toHaveBeenCalledWith("/room/room-3");
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

    await user.type(screen.getByLabelText(/display name/i), "Sam");
    await user.type(screen.getByLabelText(/room code/i), "missing-room");
    await user.click(screen.getByRole("button", { name: /join room/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/that room code was not found/i);
    expect(credentials.save).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("disables controls while a create request is pending", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const credentials = createCredentials();
    const navigate = vi.fn();
    const deferred = createDeferred<Awaited<ReturnType<RoomApi["createRoom"]>>>();

    vi.mocked(api.createRoom).mockReturnValue(deferred.promise);

    render(<LandingPage api={api} credentials={credentials} navigate={navigate} />);

    await user.type(screen.getByLabelText(/display name/i), "Alex");
    await user.click(screen.getByRole("button", { name: /create room/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/display name/i)).toBeDisabled();
    });

    expect(screen.getByLabelText(/room code/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /create room/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /join room/i })).toBeDisabled();

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

    await user.type(screen.getByLabelText(/display name/i), "Sam");
    await user.type(screen.getByLabelText(/room code/i), "room-enter{Enter}");

    expect(api.joinRoom).toHaveBeenCalledWith("room-enter", "Sam");
    expect(credentials.save).toHaveBeenCalledWith("room-enter", {
      participantToken: "pt",
    });
    expect(navigate).toHaveBeenCalledWith("/room/room-enter");
  });
});
