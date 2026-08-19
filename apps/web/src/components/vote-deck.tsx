import { VOTE_VALUES, type VoteValue } from "@scrum-poker/protocol";
import { cn } from "@/lib/utils.js";

interface VoteDeckProps {
  onVote: (value: VoteValue) => void;
  pendingValue?: VoteValue | null;
  revealed: boolean;
  selectedValue: VoteValue | null;
}

export function VoteDeck({ onVote, pendingValue = null, revealed, selectedValue }: VoteDeckProps) {
  const disabled = revealed || pendingValue !== null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {VOTE_VALUES.map((value) => {
          const selected = value === selectedValue;

          return (
            <button
              aria-pressed={selected}
              className={cn(
                "min-h-11 min-w-11 rounded-3xl border px-4 py-3 text-lg font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
                selected
                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--ring)] hover:text-[var(--primary)]",
              )}
              disabled={disabled}
              key={value}
              onClick={() => {
                onVote(value);
              }}
              type="button"
            >
              {value}
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="text-sm text-[var(--muted-foreground)]">
        {revealed
          ? "Votes are revealed. Pick again after the next reset."
          : pendingValue !== null
            ? `Saving your ${pendingValue} vote.`
            : selectedValue === null
              ? "No card selected yet."
              : `Selected card: ${selectedValue}`}
      </p>
    </div>
  );
}
