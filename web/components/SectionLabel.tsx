import { cn } from "@/lib/cn";

export function SectionLabel({
  children,
  className,
  align = "center",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "center";
}) {
  return (
    <div
      className={cn(
        "flex",
        align === "center" ? "justify-center" : "justify-start",
        className
      )}
    >
      <span className="es-section-label">
        <span className="h-px w-6 bg-text-faint/40" />
        {children}
        <span className="h-px w-6 bg-text-faint/40" />
      </span>
    </div>
  );
}
