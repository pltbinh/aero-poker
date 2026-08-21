import { createContext, useContext, useState, type PropsWithChildren } from "react";
import { createPortal } from "react-dom";
import { ThemeToggle } from "./theme-toggle.js";

const HeaderActionsTargetContext = createContext<HTMLDivElement | null>(null);

export function AppHeaderActions({ children }: PropsWithChildren) {
  const target = useContext(HeaderActionsTargetContext);

  return target === null ? null : createPortal(children, target);
}

export function AppShell({ children }: PropsWithChildren) {
  const [headerActionsTarget, setHeaderActionsTarget] = useState<HTMLDivElement | null>(null);

  return (
    <HeaderActionsTargetContext.Provider value={headerActionsTarget}>
      <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <a
          className="skip-link absolute left-4 top-4 z-50 rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] focus-visible:translate-y-0"
          href="#main-content"
        >
          Skip to main content
        </a>
        <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--panel)]/95 backdrop-blur">
          <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
            <p className="shrink-0 text-sm font-bold uppercase tracking-[0.2em] text-[var(--foreground)]">
              Aero Poker
            </p>
            <div className="flex min-w-0 items-center justify-end gap-2">
              <div className="flex min-w-0 items-center justify-end gap-2" ref={setHeaderActionsTarget} />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main
          className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8"
          id="main-content"
        >
          {children}
        </main>
      </div>
    </HeaderActionsTargetContext.Provider>
  );
}
