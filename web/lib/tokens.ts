/**
 * Shared visual constants for the landing page. Keep this short — the source
 * of truth is `tailwind.config.ts` + `app/globals.css`. This file exists so
 * that motion components and inline SVGs can read the same numbers.
 */

/**
 * Version of the most recent extension release published on GitHub. Hand-edited
 * at release time — this is the single source of truth for the "Download
 * EmailSignal vX.Y.Z" string and for the deep-link to the release asset on the
 * `/install` page. Keep it in sync with `public/manifest.json` `version`.
 * (See issue #77 for the follow-up to automate this across Vercel/GitHub.)
 */
export const LATEST_VERSION = "0.1.0";

export const SITE = {
  name: "EmailSignal",
  tagline: "The few things that need you today. Nothing else.",
  description:
    "A Chrome extension that turns your noisy Gmail or Outlook inbox into a short list of decisions. Reads only what you can see. Never sends or deletes anything. Every action passes through your approval.",
  url: "https://emailsignal.app",
  twitter: "@emailsignal",
  githubUrl: "https://github.com/atimothee/email-signal",
  /**
   * In-app install guide route. Today this is where the primary CTA actually
   * sends users — the unpacked-zip bridge install. Once the Chrome Web Store
   * listing is live, the CTA can flip to `chromeStoreUrl` below.
   */
  installUrl: "/install",
  /**
   * Direct download for the latest release asset. GitHub serves a stable
   * redirect at `/releases/latest/download/<asset>`, but the asset filename
   * embeds the version, so we still need `LATEST_VERSION` to build the URL.
   */
  releaseAssetUrl: `https://github.com/atimothee/email-signal/releases/download/v${LATEST_VERSION}/email-signal-extension-${LATEST_VERSION}.zip`,
  /**
   * GitHub releases index — fallback / "specific build" link when the
   * versioned asset URL ever 404s (e.g. mid-release window).
   */
  releasesUrl: "https://github.com/atimothee/email-signal/releases",
  /**
   * Reserved for the *future* Chrome Web Store listing. The CTA prefers
   * `installUrl` until this becomes a real https:// URL — see issue #77.
   */
  chromeStoreUrl: "#waitlist",
} as const;

export const MOTION = {
  /** Spring used for arrivals (cards, demo collapse). */
  spring: { type: "spring", stiffness: 380, damping: 32, mass: 0.9 } as const,
  /** Soft exit. */
  ease: [0.2, 0.65, 0.3, 0.95] as const,
};

export const ACCENT = "#4d9eff";
