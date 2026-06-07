import { cn } from "@/lib/cn";

/**
 * A miniature of the in-app "Ambient Pulse" — bright core + soft animated ring.
 * Used in section labels and the demo header to echo the product's liveness cue.
 */
export function PulseDot({
  className,
  tone = "accent",
}: {
  className?: string;
  tone?: "accent" | "success" | "warn" | "danger" | "muted";
}) {
  const toneClass = {
    accent: "bg-accent shadow-[0_0_12px_rgb(var(--accent)/0.6)]",
    success: "bg-success shadow-[0_0_12px_rgb(var(--success)/0.6)]",
    warn: "bg-warn shadow-[0_0_12px_rgb(var(--warn)/0.55)]",
    danger: "bg-danger shadow-[0_0_12px_rgb(var(--danger)/0.55)]",
    muted: "bg-text-faint shadow-none",
  }[tone];
  const ringClass = {
    accent: "border-accent/40",
    success: "border-success/40",
    warn: "border-warn/40",
    danger: "border-danger/40",
    muted: "border-text-faint/30",
  }[tone];
  return (
    <span
      className={cn(
        "relative inline-flex h-2.5 w-2.5 items-center justify-center",
        className
      )}
      aria-hidden
    >
      <span className={cn("h-2.5 w-2.5 rounded-full", toneClass)} />
      {tone !== "muted" && (
        <span
          className={cn(
            "absolute inset-0 rounded-full border animate-pulse-ring",
            ringClass
          )}
        />
      )}
    </span>
  );
}
