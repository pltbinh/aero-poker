import type { ParticipantView, RoomPhase } from "@scrum-poker/protocol";
import { Badge } from "./ui/badge.js";

interface ParticipantListProps {
  participants: ParticipantView[];
  phase: RoomPhase;
  selfParticipantId: string;
}

function participantStatus(participant: ParticipantView, phase: RoomPhase): string {
  if (phase === "revealed") {
    return participant.vote ?? "No vote";
  }

  return participant.hasVoted ? "Voted" : "Waiting";
}

export function ParticipantList({ participants, phase, selfParticipantId }: ParticipantListProps) {
  return (
    <ul aria-label="Participants" className="space-y-3">
      {participants.map((participant) => {
        const isSelf = participant.id === selfParticipantId;

        return (
          <li
            className="flex items-center justify-between gap-4 rounded-3xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
            key={participant.id}
          >
            <div className="flex min-w-0 items-center gap-3">
              <p className="truncate text-sm font-semibold text-[var(--foreground)]">{participant.displayName}</p>
              {isSelf ? <Badge>You</Badge> : null}
            </div>
            <p className="shrink-0 text-sm text-[var(--muted-foreground)]">{participantStatus(participant, phase)}</p>
          </li>
        );
      })}
    </ul>
  );
}
