import { MoonStar, SunMedium } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === "dark";
  const label = mounted ? (isDark ? "Dark" : "Light") : "System";

  return (
    <button
      aria-label="Toggle theme"
      className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] p-2.5 text-sm font-medium text-[var(--foreground)] shadow-sm transition hover:border-[var(--ring)] hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] sm:px-3 sm:py-2"
      onClick={() => {
        setTheme(isDark ? "light" : "dark");
      }}
      type="button"
    >
      {isDark ? <SunMedium className="size-4" aria-hidden="true" /> : <MoonStar className="size-4" aria-hidden="true" />}
      <span className="hidden sm:inline">Theme</span>
      <span className="sr-only sm:not-sr-only sm:rounded-full sm:bg-[var(--secondary)] sm:px-2 sm:py-0.5 sm:text-xs sm:text-[var(--secondary-foreground)]">
        {label}
      </span>
    </button>
  );
}
