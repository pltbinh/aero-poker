import type { HTMLAttributes, PropsWithChildren } from "react";

export function TooltipProvider({ children }: PropsWithChildren) {
  return <>{children}</>;
}

export function Tooltip({ children }: PropsWithChildren) {
  return <>{children}</>;
}

export function TooltipTrigger(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={props.type ?? "button"} {...props} />;
}

export function TooltipContent(props: HTMLAttributes<HTMLDivElement>) {
  return <div role={props.role ?? "tooltip"} {...props} />;
}
