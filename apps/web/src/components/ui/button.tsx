import { forwardRef } from "react";
import { cn } from "@/lib/utils.js";

type ButtonVariant = "primary" | "outline" | "secondary" | "ghost";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--primary)] text-[var(--primary-foreground)] hover:translate-y-[-1px] hover:shadow-lg",
  outline:
    "border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--ring)] hover:text-[var(--primary)]",
  secondary: "bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:opacity-90",
  ghost: "bg-transparent text-[var(--foreground)] hover:bg-[var(--surface-muted)]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, type = "button", variant = "primary", ...props },
  ref,
) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        className,
      )}
      ref={ref}
      type={type}
      {...props}
    />
  );
});
