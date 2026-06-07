"use client";

import Link from "next/link";
import { SITE } from "@/lib/tokens";
import { ChromeGlyph } from "./icons/Chrome";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost";

export function CtaButton({
  // Default to the in-app install guide — that's the real install path until
  // the Chrome Web Store listing goes live. `SITE.chromeStoreUrl` is reserved
  // for the future store URL (see `web/lib/tokens.ts`).
  href = SITE.installUrl,
  variant = "primary",
  children,
  className,
  prefetch = false,
}: {
  href?: string;
  variant?: Variant;
  children?: React.ReactNode;
  className?: string;
  prefetch?: boolean;
}) {
  const isAnchor = href.startsWith("#");
  const isExternal = /^https?:/.test(href);
  const cls = cn(variant === "primary" ? "es-btn" : "es-btn-ghost", className);

  const inner =
    children ??
    (variant === "primary" ? (
      <>
        <ChromeGlyph />
        <span>Add to Chrome — it&apos;s free</span>
      </>
    ) : (
      <span>See how it works</span>
    ));

  if (isAnchor) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} prefetch={prefetch} className={cls}>
      {inner}
    </Link>
  );
}
