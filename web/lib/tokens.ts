/**
 * Shared visual constants for the landing page. Keep this short — the source
 * of truth is `tailwind.config.ts` + `app/globals.css`. This file exists so
 * that motion components and inline SVGs can read the same numbers.
 */

export const SITE = {
  name: "EmailSignal",
  tagline: "The few things that need you today. Nothing else.",
  description:
    "A Chrome extension that turns your noisy Gmail into a short list of decisions. Reads only what you can see. Never sends or deletes anything. Every action passes through your approval.",
  url: "https://emailsignal.app",
  twitter: "@emailsignal",
  githubUrl: "https://github.com/atimothee/email-signal",
  /** Placeholder until the Chrome Web Store listing exists. */
  chromeStoreUrl: "#waitlist",
} as const;

export const MOTION = {
  /** Spring used for arrivals (cards, demo collapse). */
  spring: { type: "spring", stiffness: 380, damping: 32, mass: 0.9 } as const,
  /** Soft exit. */
  ease: [0.2, 0.65, 0.3, 0.95] as const,
};

export const ACCENT = "#4d9eff";
