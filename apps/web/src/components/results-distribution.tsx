import { VOTE_VALUES, type ParticipantView } from "@scrum-poker/protocol";

interface ResultsDistributionProps {
  participants: ParticipantView[];
}

function formatVotes(count: number): string {
  return `${count} vote${count === 1 ? "" : "s"}`;
}

export function ResultsDistribution({ participants }: ResultsDistributionProps) {
  const counts = new Map<string, number>();

  for (const participant of participants) {
    if (participant.vote === undefined) {
      continue;
    }

    counts.set(participant.vote, (counts.get(participant.vote) ?? 0) + 1);
  }

  const rows = VOTE_VALUES.filter((value) => counts.has(value)).map((value) => ({
    value,
    count: counts.get(value) ?? 0,
  }));
  const maxCount = rows.reduce((largest, row) => Math.max(largest, row.count), 1);

  if (rows.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">No revealed votes yet.</p>;
  }

  return (
    <ul aria-label="Revealed vote distribution" className="space-y-3">
      {rows.map((row) => (
        <li className="space-y-2 rounded-3xl border border-[var(--border)] bg-[var(--card)] p-4" key={row.value}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-lg font-semibold text-[var(--foreground)]">{row.value}</span>
            <span className="text-sm text-[var(--muted-foreground)]">{formatVotes(row.count)}</span>
          </div>
          <div className="h-3 rounded-full bg-[var(--surface-muted)]">
            <div
              className="h-full rounded-full bg-[var(--primary)]"
              style={{ width: `${(row.count / maxCount) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
