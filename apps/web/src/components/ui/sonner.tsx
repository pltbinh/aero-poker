import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ToasterProps {
  message: string | null;
  durationMs?: number;
  onDismiss: () => void;
  tone?: "info" | "success";
}

export function Toaster({ message, durationMs = 1_500, onDismiss, tone = "info" }: ToasterProps) {
  useEffect(() => {
    if (message === null) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      onDismiss();
    }, durationMs);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [durationMs, message, onDismiss]);

  if (message === null) {
    return null;
  }

  const toast = (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--foreground)] shadow-[var(--card-shadow)]"
      role="status"
    >
      <div className="flex items-start gap-3">
        {tone === "success" ? (
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
        ) : (
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
        )}
        <span>{message}</span>
      </div>
    </div>
  );

  return typeof document === "undefined" ? toast : createPortal(toast, document.body);
}
