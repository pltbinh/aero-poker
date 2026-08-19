import type { PropsWithChildren } from "react";
import { ThemeToggle } from "./theme-toggle.js";

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <a
        className="skip-link absolute left-4 top-4 z-50 rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] focus-visible:translate-y-0"
        href="#main-content"
      >
        Skip to main content
      </a>
      <header className="border-b border-[var(--border)] bg-[var(--panel)]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
              Scrum Poker
            </p>
            <p className="text-sm text-[var(--muted-foreground)]">
              Lightweight planning poker over ordinary HTTP and native EventSource.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12"
        id="main-content"
      >
        {children}
      </main>
    </div>
  );
}
