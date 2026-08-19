import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ParticipantView } from "@scrum-poker/protocol";
import { ResultsDistribution } from "../src/components/results-distribution.js";

describe("ResultsDistribution", () => {
  it("counts exact revealed string votes, including question marks and coffee", () => {
    const participants: ParticipantView[] = [
      { id: "alex", displayName: "Alex", hasVoted: true, vote: "8" },
      { id: "sam", displayName: "Sam", hasVoted: true, vote: "8" },
      { id: "pat", displayName: "Pat", hasVoted: true, vote: "?" },
      { id: "jo", displayName: "Jo", hasVoted: true, vote: "☕" },
    ];

    render(<ResultsDistribution participants={participants} />);

    const distribution = screen.getByRole("list", { name: /revealed vote distribution/i });
    const rows = within(distribution).getAllByRole("listitem");

    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("8")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("2 votes")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("?")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("1 vote")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("☕")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("1 vote")).toBeInTheDocument();
  });

  it("does not render an average summary for revealed votes", () => {
    const participants: ParticipantView[] = [
      { id: "alex", displayName: "Alex", hasVoted: true, vote: "3" },
      { id: "sam", displayName: "Sam", hasVoted: true, vote: "5" },
    ];

    render(<ResultsDistribution participants={participants} />);

    expect(screen.queryByText(/average/i)).not.toBeInTheDocument();
  });
});
