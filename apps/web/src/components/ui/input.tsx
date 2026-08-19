import { forwardRef } from "react";
import { cn } from "@/lib/utils.js";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      className={cn(
        "w-full rounded-2xl border border-[var(--input)] bg-[var(--background)] px-4 py-3 text-base text-[var(--foreground)] shadow-sm transition placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
