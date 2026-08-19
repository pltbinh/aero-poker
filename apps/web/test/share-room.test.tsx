import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareRoom } from "../src/components/share-room.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ShareRoom", () => {
  it("shows a manual copy field when navigator.clipboard is unavailable", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", { clipboard: undefined });

    render(<ShareRoom basePath="/scrum-poker/" origin="https://planning.example" roomId="room-1" />);

    await user.click(screen.getByRole("button", { name: /copy share link/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: /manual share link/i })).toHaveValue(
      "https://planning.example/scrum-poker/#/room/room-1",
    );
  });

  it("shows a manual copy field when clipboard writing fails", async () => {
    const user = userEvent.setup();
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error("clipboard denied")) };

    render(
      <ShareRoom
        basePath="/scrum-poker/"
        clipboard={clipboard}
        origin="https://planning.example"
        roomId="room-1"
      />,
    );

    await user.click(screen.getByRole("button", { name: /copy share link/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: /manual share link/i })).toHaveValue(
      "https://planning.example/scrum-poker/#/room/room-1",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
