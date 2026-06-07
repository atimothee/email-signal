import { cn } from "@/lib/cn";

/**
 * The "Ambient Pulse" miniaturized — same mark as the Chrome extension icon.
 * A bright core + soft ring on a deep blue tile. Single concept: one signal
 * surfaced from the noise.
 */
export function BrandMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <defs>
        <radialGradient id="es-tile" cx="50%" cy="42%" r="72%">
          <stop offset="0%" stopColor="#2f78de" />
          <stop offset="55%" stopColor="#1b56b4" />
          <stop offset="100%" stopColor="#0a2f6b" />
        </radialGradient>
        <filter
          id="es-glow"
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.8" />
        </filter>
      </defs>
      <rect x="0" y="0" width="64" height="64" rx="14" ry="14" fill="url(#es-tile)" />
      <circle cx="32" cy="32" r="8" fill="rgba(173,210,255,0.4)" filter="url(#es-glow)" />
      <circle
        cx="32"
        cy="32"
        r="16.6"
        fill="none"
        stroke="#d4e6ff"
        strokeOpacity="0.78"
        strokeWidth="1.6"
      />
      <circle cx="32" cy="32" r="7" fill="#f2f7ff" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <BrandMark size={28} />
      <span className="text-[15px] font-semibold tracking-tight text-text">
        EmailSignal
      </span>
    </div>
  );
}
