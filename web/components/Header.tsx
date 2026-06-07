"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "./BrandMark";
import { CtaButton } from "./CtaButton";
import { GitHubGlyph } from "./icons/Chrome";
import { SITE } from "@/lib/tokens";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "#demo", label: "See it" },
  { href: "#time", label: "Time-aware" },
  { href: "#safety", label: "Safety" },
  { href: "#start", label: "Get started" },
  { href: "#faq", label: "FAQ" },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-all",
        scrolled
          ? "backdrop-blur-md bg-bg/70 border-b border-white/[0.05]"
          : "bg-transparent border-b border-transparent"
      )}
    >
      <div className="container flex h-[60px] items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="EmailSignal home">
          <Wordmark />
        </Link>

        <nav className="hidden md:flex items-center gap-7">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[13px] text-text-dim hover:text-text transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href={SITE.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-pill text-text-dim hover:text-text hover:bg-white/5 transition-colors"
            aria-label="EmailSignal on GitHub"
          >
            <GitHubGlyph size={17} />
          </a>
          <CtaButton className="!px-4 !py-2 !text-[13px]">
            <span className="hidden sm:inline">Add to Chrome</span>
            <span className="sm:hidden">Install</span>
          </CtaButton>
        </div>
      </div>
    </header>
  );
}
