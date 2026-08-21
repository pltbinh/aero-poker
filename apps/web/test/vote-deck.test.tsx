import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VoteValue } from "@scrum-poker/protocol";
import { VoteDeck } from "../src/components/vote-deck.js";

afterEach(() => {
  cleanup();
});

describe("VoteDeck", () => {
  it("renders every planning choice as a small poker card with one centered value", () => {
    const onVote = vi.fn();
    const expectedValues = ["☕", "1", "2", "3", "5", "8", "13"];

    render(<VoteDeck onVote={onVote} revealed={false} selectedValue={"5"} />);

    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(expectedValues);

    expect(screen.getByRole("button", { name: "5" })).toHaveAttribute("aria-pressed", "true");
    const coffeeCard = screen.getByRole("button", { name: "☕" });
    expect(coffeeCard.className).toContain("aspect-[5/7]");
    expect(coffeeCard.className).toContain("rounded-xl");
    expect(coffeeCard.className).not.toContain("rounded-3xl");
    expect(within(coffeeCard).getAllByText("☕")).toHaveLength(1);
    expect(screen.getByText(/selected card: 5/i)).toBeInTheDocument();
  });

  it("lets the participant change their selected card", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [selectedValue, setSelectedValue] = useState<VoteValue | null>("3");

      return <VoteDeck onVote={setSelectedValue} revealed={false} selectedValue={selectedValue} />;
    }

    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "13" }));

    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "13" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/selected card: 13/i)).toBeInTheDocument();
  });

  it("disables voting after reveal", async () => {
    const user = userEvent.setup();
    const onVote = vi.fn();

    render(<VoteDeck onVote={onVote} revealed selectedValue={"8"} />);

    const eightButton = screen.getByRole("button", { name: "8" });
    expect(eightButton).toBeDisabled();

    await user.click(eightButton);

    expect(onVote).not.toHaveBeenCalled();
    expect(screen.getByText(/votes are revealed/i)).toBeInTheDocument();
  });
});
