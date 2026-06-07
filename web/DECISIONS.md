# Build decisions log

Choices made while building the EmailSignal landing page autonomously, plus
the reasoning so future edits don't undo them by accident.

## Framework & tooling

- **Next.js 15 + App Router + React 19.** Static-leaning, file-based metadata,
  built-in OG image generation, edge runtime for the OG route. The brief
  specified Next.js App Router; the App Router gave us `opengraph-image.tsx`,
  `robots.ts`, and `sitemap.ts` as first-class files (no extra config).
- **Tailwind 3.4** (not 4) for stability and predictable Vercel build behavior.
  Tailwind 4's CSS-first config was tempting but offers no advantage for a
  single-page marketing site.
- **Framer Motion (v11)** for the signature animation, scroll reveals, and the
  FAQ accordion. Used `useReducedMotion` everywhere a transition fires so the
  site is calm by default for users with `prefers-reduced-motion`.
- **`@vercel/analytics`** for privacy-respecting visit telemetry — no cookies,
  no PII, no third-party network. Lights up automatically once the project
  exists on Vercel.
- **No UI kit.** Hand-built primitives (`es-card`, `es-chip`, `es-btn`,
  `PulseDot`, `BrandMark`) so the page reads like the product, not like a
  template. The visual language matches `design-guidelines.md` at the repo
  root (cobalt accent, soft surfaces, generous whitespace, calm motion).
- **No dark/light mode toggle.** The product is dark-first, the brief asks
  for "dark mode from day one", and the light tokens in `globals.css` are
  staged for future use. We don't add a toggle yet because it's pure noise
  without a real user need.

## Page architecture (matches issue #57)

The single long scroll, in this order:

1. Hero — headline ("The few things that need you today. Nothing else.") +
   CTA + trust line, with the demo positioned immediately below.
2. The before → after demo — auto-playing, reduced-motion fallback shows the
   "after" state directly.
3. Time-awareness — three cards (rising / held / demoted) + a tiny urgency
   bar visual for each.
4. Safety — the approval-card mock + six guarantees in plain language.
5. Cleanup — grouped sender sweep with per-row actions.
6. Get started — three honest steps + a pre-launch heads-up + waitlist form.
7. FAQ — eight plain-language questions, the first one open by default.
8. Closing CTA.
9. Footer — wordmark, GitHub, sitemap, honest copy line at the bottom.

A mobile-only banner (`MobileNotice`) addresses the "discovered on phone,
installed on laptop" path the brief flagged.

## Honest copy choices (do not loosen without re-reading the README)

- The hero subhead and trust line both say what we actually do: "reads the
  Gmail you have open", "no Google login", "runs on your own machine". No
  language that could be read as OAuth or "we sync your inbox".
- The Safety section's six guarantees are lifted directly from the README's
  Safety model section. Every one is verifiable in code (`policy.ts`, the
  ledger, the dry-run flag, the kill switch).
- The Get Started section ships with a **pre-launch banner** that admits the
  Chrome Web Store listing and one-click helper packaging aren't done yet,
  and links developers to the README. This is the honest version of the
  "single biggest launch dependency" called out in issue #57.
- The FAQ is explicit that the OpenAI key is yours, cost is on you, and
  "Nothing pressing" is a real answer.
- The closing CTA's small print restates the privacy posture in one line.

## The signature animation

`BeforeAfterDemo.tsx` auto-cycles through three phases — `before` (messy
Gmail with 84 unread visible), `thinking` (pulse + caption "Reading your
inbox…"), `after` (three decision cards + a single Cleanup line + the
honest day summary). It pauses when scrolled out of view, and a small
`↻ Replay` button appears once you've seen it.

With `prefers-reduced-motion: reduce`, the component jumps straight to
`after` and skips the loop. The CSS file also globally clamps animation
durations as a safety net.

The demo emails are fully fictional. No real names, no real PII, no real
domains beyond the generic ones (Spotify, Notion, Substack, LinkedIn —
these are noise senders by category, not endorsements).

## Waitlist endpoint

`app/api/waitlist/route.ts` is intentionally a **logging stub**. It runs
on the edge runtime, validates the email, and `console.log`s the signup
(visible in Vercel's runtime logs). Wire it to a real provider (Loops,
Resend audiences, Buttondown, an Airtable webhook, whatever) by replacing
the body of the handler. The UI is real; only the storage is a TODO.

## SEO / OG

- `app/opengraph-image.tsx` generates a 1200×630 PNG at the edge using
  `next/og`. It restates the headline and the trust posture so the social
  card sells the page in one look.
- `app/twitter-image.tsx` re-exports the OG card.
- `robots.ts` and `sitemap.ts` ship with the only canonical URL.
- `app/page.tsx` injects a `SoftwareApplication` JSON-LD blob for richer
  search results.

## Accessibility

- All animations are wrapped in `useReducedMotion` and the CSS file clamps
  durations as a fallback.
- Focus ring is visible (`:focus-visible` with the accent colour) and the
  skip link at the top of `layout.tsx` jumps to `#main`.
- Colour contrast was tuned against the dark surface stack
  (`#0a0e1a` background, `#f3f5fa` text, accent `#4d9eff`) and meets WCAG
  AA for body and headings.
- Buttons and the FAQ accordion expose `aria-*` and ship real semantics.
- Forms use `<label>` (`sr-only` where the placeholder is enough visually)
  and inline error messages.

## Out of scope

Per the brief, this site does **not** include pricing, a blog, docs, or the
actual sidecar-packaging work. It is the marketing landing page only.
