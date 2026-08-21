import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { Button } from "./ui/button.js";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog.js";
import { Input } from "./ui/input.js";
import { Toaster } from "./ui/sonner.js";

interface ClipboardLike {
  writeText(value: string): Promise<void>;
}

interface ShareRoomProps {
  basePath?: string | undefined;
  clipboard?: Pick<ClipboardLike, "writeText"> | undefined;
  origin?: string | undefined;
  roomId: string;
}

function normalizeBasePath(basePath: string): string {
  if (basePath === "/") {
    return basePath;
  }

  return basePath.endsWith("/") ? basePath : `${basePath}/`;
}

function readDefaultBasePath(): string {
  const envBasePath = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.BASE_URL;
  return normalizeBasePath(envBasePath ?? "/");
}

function readDefaultOrigin(): string {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

function readClipboard(providedClipboard?: Pick<ClipboardLike, "writeText">) {
  if (providedClipboard !== undefined) {
    return providedClipboard;
  }

  return typeof navigator !== "undefined" ? navigator.clipboard : undefined;
}

function buildShareUrl(roomId: string, origin: string, basePath: string): string {
  const shareUrl = new URL(normalizeBasePath(basePath), origin);
  shareUrl.hash = `/room/${encodeURIComponent(roomId)}`;
  return shareUrl.toString();
}

export function ShareRoom({
  basePath = readDefaultBasePath(),
  clipboard,
  origin = readDefaultOrigin(),
  roomId,
}: ShareRoomProps) {
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const shareUrl = buildShareUrl(roomId, origin, basePath);

  async function handleCopy() {
    setStatusMessage(null);

    const clipboardTarget = readClipboard(clipboard);

    if (clipboardTarget === undefined) {
      setFallbackUrl(shareUrl);
      return;
    }

    try {
      await clipboardTarget.writeText(shareUrl);
      setFallbackUrl(null);
      setStatusMessage("Invite link copied — send it to your crew!");
    } catch {
      setFallbackUrl(shareUrl);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Button
          className={cn(
            "px-3 py-2",
            statusMessage && "share-pop border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-foreground)]",
          )}
          data-copied={statusMessage ? "true" : undefined}
          onClick={handleCopy}
          variant="outline"
        >
          {statusMessage ? <Check aria-hidden="true" className="size-4" /> : <Share2 aria-hidden="true" className="size-4" />}
          {statusMessage ? "Copied!" : "Share"}
        </Button>
      </div>

      {fallbackUrl ? (
        <DialogContent role="dialog">
          <DialogHeader>
            <DialogTitle>Copy this room link</DialogTitle>
            <DialogDescription>Clipboard access was unavailable, so copy the room hash manually.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <Input aria-label="Manual share link" readOnly value={fallbackUrl} />
            <Button onClick={() => setFallbackUrl(null)} variant="secondary">
              Close
            </Button>
          </div>
        </DialogContent>
      ) : null}

      <Toaster
        message={statusMessage}
        onDismiss={() => {
          setStatusMessage(null);
        }}
        tone="success"
      />
    </div>
  );
}
