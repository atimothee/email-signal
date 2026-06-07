import { cn } from "@/lib/cn";

export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = "center",
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div
      className={cn(
        align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl",
        className
      )}
    >
      {eyebrow && (
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-strong/90">
          {eyebrow}
        </p>
      )}
      <h2 className="text-balance font-display text-[30px] font-semibold leading-[1.1] tracking-tightish text-text sm:text-[40px] sm:leading-[1.08]">
        {title}
      </h2>
      {lede && (
        <p
          className={cn(
            "mt-4 text-balance text-[16px] leading-relaxed text-text-dim sm:text-[17px]",
            align === "center" && "mx-auto"
          )}
        >
          {lede}
        </p>
      )}
    </div>
  );
}
