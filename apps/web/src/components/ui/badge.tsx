import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils.js";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full bg-[var(--accent-soft)] px-3 py-1 text-sm font-medium text-[var(--accent-foreground)]",
        className,
      )}
      {...props}
    />
  );
}
