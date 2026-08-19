import type { RoomConnectionStatus } from "../room/room-reducer.js";
import { Button } from "./ui/button.js";
import { cn } from "@/lib/utils.js";

interface ConnectionStatusProps {
  status: RoomConnectionStatus;
  onReconnect: () => void;
}

const statusCopy: Record<Exclude<RoomConnectionStatus, "expired">, { label: string; tone: string }> = {
  connecting: {
    label: "Connecting to room updates.",
    tone: "bg-[var(--secondary)] text-[var(--secondary-foreground)]",
  },
  connected: {
    label: "Live connection active.",
    tone: "bg-[var(--accent-soft)] text-[var(--accent-foreground)]",
  },
  reconnecting: {
    label: "Reconnecting to the room stream.",
    tone: "bg-[var(--secondary)] text-[var(--secondary-foreground)]",
  },
  offline: {
    label: "Offline. Live updates are paused until you reconnect.",
    tone: "bg-[color:color-mix(in_srgb,var(--destructive)_14%,var(--card))] text-[var(--foreground)]",
  },
};

export function ConnectionStatus({ status, onReconnect }: ConnectionStatusProps) {
  if (status === "expired") {
    return null;
  }

  const content = statusCopy[status];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p
        className={cn(
          "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium",
          content.tone,
        )}
      >
        {content.label}
      </p>
      {status === "offline" ? (
        <Button onClick={onReconnect} variant="outline">
          Reconnect
        </Button>
      ) : null}
    </div>
  );
}
