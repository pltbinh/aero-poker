import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomApi } from "../src/api/room-api.js";
import type { RoomCredentialStore } from "../src/auth/room-credentials.js";
import { App } from "../src/app.js";

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

describe("App routing", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  it("renders the shell and restores the room code from a shared hash route", async () => {
    window.location.hash = "#/room/room-restore";

    render(<App api={createApi()} credentials={createCredentials()} />);

    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeInTheDocument();
    expect(await screen.findByLabelText(/room code/i)).toHaveValue("room-restore");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("redirects unknown hashes back to the landing page", async () => {
    window.location.hash = "#/not-a-route";

    render(<App api={createApi()} credentials={createCredentials()} />);

    expect(await screen.findByRole("heading", { name: /estimate together/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(window.location.hash).toBe("#/");
    });
  });
});
