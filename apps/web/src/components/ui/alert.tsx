import type { HTMLAttributes } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils.js";

export function Alert({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[color:color-mix(in_srgb,var(--destructive)_24%,transparent)] bg-[color:color-mix(in_srgb,var(--destructive)_10%,var(--card))] px-4 py-3 text-sm text-[var(--foreground)]",
        className,
      )}
      role={props.role ?? "alert"}
      {...props}
    >
      <div className="flex items-start gap-3">
        <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--destructive)]" />
        <div>{children}</div>
      </div>
    </div>
  );
}
