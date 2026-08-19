import { AlertCircle } from "lucide-react";
import { useEffect } from "react";

interface ToasterProps {
  message: string | null;
  durationMs?: number;
  onDismiss: () => void;
}

export function Toaster({ message, durationMs = 1_500, onDismiss }: ToasterProps) {
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

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--foreground)] shadow-[var(--card-shadow)]"
      role="status"
    >
      <div className="flex items-start gap-3">
        <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
        <span>{message}</span>
      </div>
    </div>
  );
}
