import type { RoomPhase } from "@scrum-poker/protocol";
import { Button } from "./ui/button.js";

interface FacilitatorControlsProps {
  canFacilitate: boolean;
  onReset: () => void;
  onReveal: () => void;
  pendingReset: boolean;
  pendingReveal: boolean;
  phase: RoomPhase;
}

export function FacilitatorControls({
  canFacilitate,
  onReset,
  onReveal,
  pendingReset,
  pendingReveal,
  phase,
}: FacilitatorControlsProps) {
  if (!canFacilitate) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button disabled={phase === "revealed" || pendingReveal} onClick={onReveal} variant="secondary">
        Reveal votes
      </Button>
      <Button disabled={phase === "voting" || pendingReset} onClick={onReset} variant="outline">
        Reset round
      </Button>
    </div>
  );
}
