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
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-7 sm:gap-4">
        {VOTE_VALUES.map((value) => {
          const selected = value === selectedValue;

          return (
            <button
              aria-pressed={selected}
              aria-label={value}
              className={cn(
                "group relative aspect-[5/7] min-h-14 min-w-12 w-full max-w-24 justify-self-center overflow-hidden rounded-xl border-2 p-1 font-[var(--font-game)] font-black shadow-[0_7px_0_rgba(43,36,27,0.16),0_12px_24px_rgba(54,43,26,0.14)] transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:transform-none",
                selected
                  ? "-translate-y-2 rotate-[-1deg] border-[var(--primary)] bg-[var(--secondary)] text-[var(--primary)] ring-2 ring-[color:color-mix(in_srgb,var(--primary)_24%,transparent)] shadow-[0_11px_0_rgba(63,78,184,0.2),0_18px_28px_rgba(63,78,184,0.24)]"
                  : "border-[var(--border)] bg-[linear-gradient(145deg,var(--card),var(--surface-muted))] text-[var(--foreground)] hover:-translate-y-2 hover:rotate-1 hover:border-[var(--ring)] hover:text-[var(--primary)] hover:shadow-[0_11px_0_rgba(43,36,27,0.14),0_18px_28px_rgba(54,43,26,0.2)]",
              )}
              disabled={disabled}
              key={value}
              onClick={() => {
                onVote(value);
              }}
              type="button"
            >
              <span aria-hidden="true" className="grid h-full place-items-center text-2xl leading-none drop-shadow-sm sm:text-3xl">
                {value}
              </span>
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
