# EmailSignal — Marketing landing page

A self-contained Next.js (App Router) app that lives in `web/` and ships the
public marketing site for EmailSignal.

This app does **not** touch the Chrome extension or the local sidecar build.
It has its own `package.json`, its own dependencies, and its own deploy.

## Develop

```bash
cd web
npm install
npm run dev          # → http://localhost:3000
```

The dev server starts in ~1s. Edit anything under `app/`, `components/`, or
`lib/`; HMR will reload.

## Build

```bash
cd web
npm run build        # static-leaning Next build (SSG where possible)
npm run start        # serve the built output locally
npm run typecheck    # strict TS check, no emit
npm run lint         # next + typescript-aware ESLint
```

CI should run `typecheck`, `lint`, and `build`.

## Deploy on Vercel

Create a Vercel project pointing at this repository and set:

| Setting               | Value         |
| --------------------- | ------------- |
| **Root Directory**    | `web`         |
| Framework Preset      | Next.js       |
| Install Command       | `npm install` |
| Build Command         | `next build`  |
| Output Directory      | _(default)_   |
| Node.js Version       | 20.x or 22.x  |

With Root Directory set to `web`, Vercel ignores the extension / sidecar
build at the repo root entirely. No workspaces, no monorepo config needed.

Optional: enable **Vercel Analytics** in the project — this app already
includes the `@vercel/analytics/react` script, so it lights up automatically.

## What's in here

```
web/
  app/
    layout.tsx            # global shell, fonts, analytics, OG metadata
    page.tsx              # composes every section in order
    globals.css           # design tokens + small component layer
    opengraph-image.tsx   # generated 1200×630 social card
    twitter-image.tsx     # re-exports the OG card
    robots.ts / sitemap.ts
    api/waitlist/route.ts # email capture stub (logs only, ready to wire)
    icon.svg              # favicon (matches the extension mark)
    not-found.tsx         # "Nothing pressing here" 404
  components/
    Header.tsx            # sticky nav, install CTA
    Hero.tsx              # headline, CTAs, the demo
    BeforeAfterDemo.tsx   # THE signature animation (auto-play, reduced-motion)
    TimeAwareness.tsx     # "Recent isn't important" cards
    Safety.tsx            # approval-card mock + 6 guarantees
    Cleanup.tsx           # grouped clutter sweep
    GetStarted.tsx        # 3 honest steps + pre-launch banner
    FAQ.tsx               # plain-language FAQ accordion
    ClosingCTA.tsx
    Footer.tsx
    WaitlistForm.tsx      # POSTs /api/waitlist
    MobileNotice.tsx      # "this is a desktop extension" banner
    Reveal.tsx            # scroll-in motion wrapper (reduced-motion aware)
    BrandMark.tsx         # the in-app Ambient Pulse, miniaturized
    PulseDot.tsx
    CtaButton.tsx
    SectionHeading.tsx
    Container.tsx
    SectionLabel.tsx
    icons/Chrome.tsx
  lib/
    demo-data.ts          # fully fictional inbox + decision cards
    tokens.ts             # SITE constants + motion presets
    cn.ts                 # tiny classnames join
  DECISIONS.md            # autonomous-build decision log
  README.md               # this file
```

## Honesty guardrails

Every claim on the page must be verifiably true of the shipped product
(README.md at repo root). When you edit copy, re-check these:

- ❌ Never imply Google-account / OAuth access. We read the visible Gmail DOM.
- ❌ Never imply it writes, sends, or auto-handles email. It proposes; the
  user approves; sending / deleting is hard-blocked in code.
- ❌ Never hide the OpenAI-key requirement.
- ✅ Always celebrate "Nothing pressing" — that is the brand.

See `DECISIONS.md` for the choices made during the initial build and why.
