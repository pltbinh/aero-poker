import type { RoomConnectionStatus } from "../room/room-reducer.js";
import { Button } from "./ui/button.js";
import { cn } from "@/lib/utils.js";

interface ConnectionStatusProps {
  status: RoomConnectionStatus;
  onReconnect: () => void;
}

const statusCopy: Record<Exclude<RoomConnectionStatus, "expired">, { label: string; tone: string }> = {
  connecting: {
    label: "Connecting",
    tone: "bg-[var(--secondary)] text-[var(--secondary-foreground)]",
  },
  connected: {
    label: "Connected",
    tone: "bg-[var(--accent-soft)] text-[var(--accent-foreground)]",
  },
  reconnecting: {
    label: "Reconnecting",
    tone: "bg-[var(--secondary)] text-[var(--secondary-foreground)]",
  },
  offline: {
    label: "Offline",
    tone: "bg-[color:color-mix(in_srgb,var(--destructive)_14%,var(--card))] text-[var(--foreground)]",
  },
};

export function ConnectionStatus({ status, onReconnect }: ConnectionStatusProps) {
  if (status === "expired") {
    return null;
  }

  const content = statusCopy[status];

  return (
    <div className="flex min-w-0 items-center gap-2">
      <p
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:h-auto sm:w-auto sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-sm",
          content.tone,
        )}
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-current opacity-75" />
        <span className="sr-only sm:not-sr-only">{content.label}</span>
      </p>
      {status === "offline" ? (
        <Button className="px-3 py-2" onClick={onReconnect} variant="outline">
          Reconnect
        </Button>
      ) : null}
    </div>
  );
}
