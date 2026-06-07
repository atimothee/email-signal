import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Container } from "@/components/Container";
import { LATEST_VERSION, SITE } from "@/lib/tokens";

// Hand-port of `INSTALL.md`. The repo root keeps the markdown as the canonical
// reference (linked from `README.md` and from anyone landing on the GitHub repo
// directly); this page exists to give a polished, on-brand surface for visitors
// arriving from the landing-page CTA. If they ever drift, sync them by hand —
// MDX scaffolding isn't worth pulling in for a single page.

export const metadata: Metadata = {
  title: `Install EmailSignal v${LATEST_VERSION}`,
  description:
    "Download EmailSignal and load it in Chrome in about 2 minutes. No Chrome Web Store, no Google login, no telemetry.",
  alternates: { canonical: "/install" },
  openGraph: {
    title: `Install EmailSignal v${LATEST_VERSION}`,
    description:
      "Download EmailSignal and load it in Chrome in about 2 minutes. No Chrome Web Store, no Google login, no telemetry.",
    url: `${SITE.url}/install`,
  },
};

export default function InstallPage() {
  return (
    <>
      <Header />
      <main id="main" className="relative pb-24 pt-10 sm:pt-16">
        <Container>
          <article className="mx-auto max-w-2xl">
            <p className="es-section-label">Install · v{LATEST_VERSION}</p>
            <h1 className="mt-3 text-balance font-display text-[36px] font-semibold leading-[1.08] tracking-tighter2 text-text sm:text-[48px]">
              Install EmailSignal in about 2 minutes.
            </h1>
            <p className="mt-5 text-balance text-[16px] leading-relaxed text-text-dim sm:text-[17px]">
              Two pieces: load the extension into Chrome from a folder, and
              start a tiny local helper that holds your OpenAI key and does the
              AI work. Nothing leaves your machine except the snippets the
              helper sends to OpenAI — there&apos;s no EmailSignal server, no
              Gmail/Outlook OAuth, and no auto-send or auto-delete.
            </p>

            {/* Primary CTA — deep-link straight at the versioned asset.
             * GitHub serves a `/releases/latest/download/<asset>` redirect, but
             * the filename embeds the version, so we still need
             * `LATEST_VERSION` to build the URL. See `web/lib/tokens.ts`. */}
            <div className="mt-8 flex flex-col items-start gap-3 rounded-card border border-white/[0.08] bg-surface/70 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-text-faint">
                  Step 1 — Download
                </p>
                <p className="mt-1 text-[15px] text-text-dim">
                  About 4 MB · loads via Chrome&apos;s Developer mode.
                </p>
              </div>
              <a
                href={SITE.releaseAssetUrl}
                className="es-btn whitespace-nowrap"
                rel="noopener noreferrer"
              >
                <span>Download EmailSignal v{LATEST_VERSION}</span>
              </a>
            </div>

            <p className="mt-3 text-[12.5px] text-text-faint">
              Or grab a specific build →{" "}
              <a
                href={SITE.releasesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-strong underline-offset-2 hover:underline"
              >
                all releases on GitHub
              </a>
              .
            </p>

            <Step number={2} title="Load it in Chrome">
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-text-dim">
                <li>
                  Open <code className="es-code">chrome://extensions</code> in a
                  new tab.
                </li>
                <li>
                  Toggle <strong className="text-text">Developer mode</strong>{" "}
                  on (top right).
                </li>
                <li>
                  Click <strong className="text-text">Load unpacked</strong> and
                  select the <em>unzipped folder</em> from Step 1 — the one
                  with <code className="es-code">manifest.json</code> at the
                  top.
                </li>
                <li>
                  Pin the EmailSignal icon to your Chrome toolbar (puzzle-piece
                  icon → pin).
                </li>
              </ol>
              <p className="mt-3 text-[13px] text-text-faint">
                Heads up: macOS Finder sometimes adds a wrapping folder when
                unzipping. If Chrome says &ldquo;manifest is invalid&rdquo;,
                pick the inner folder.
              </p>
            </Step>

            <Step number={3} title="Start the helper">
              <p className="mt-2 text-text-dim">
                The helper runs on your laptop, holds your OpenAI key, and does
                the AI work. It needs{" "}
                <a
                  href="https://nodejs.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-strong underline-offset-2 hover:underline"
                >
                  Node.js 20+
                </a>
                . In a terminal:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-card border border-white/[0.08] bg-surface-2 p-4 text-[12.5px] leading-relaxed text-text">
                <code>{`git clone https://github.com/atimothee/email-signal
cd email-signal
npm install
cp .env.example .env
# paste your OpenAI key into .env  (or paste it in the extension Settings tab)
npm run server`}</code>
              </pre>
              <p className="mt-3 text-text-dim">
                The terminal will say{" "}
                <code className="es-code">Listening on http://localhost:3030</code>
                . <strong className="text-text">Leave it open</strong> —
                closing it stops the helper.
              </p>
              <p className="mt-3 text-[13px] text-text-faint">
                No OpenAI key yet? Create one at{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-strong underline-offset-2 hover:underline"
                >
                  platform.openai.com/api-keys
                </a>
                . You pay OpenAI directly; EmailSignal never sees or stores it.
              </p>
            </Step>

            <Step number={4} title="Open Gmail or Outlook">
              <p className="mt-2 text-text-dim">
                Visit Gmail (<code className="es-code">mail.google.com</code>)
                or Outlook (<code className="es-code">outlook.live.com</code>,{" "}
                <code className="es-code">outlook.office.com</code>,{" "}
                <code className="es-code">outlook.office365.com</code>), click
                the pinned EmailSignal icon, and the side panel opens.
              </p>
              <p className="mt-3 text-text-dim">
                The first scan can take{" "}
                <strong className="text-text">10–20 seconds</strong> while the
                helper classifies your inbox. After that, scans are cached and
                feel instant.
              </p>
              <p className="mt-3 text-text-dim">
                You&apos;re done. <strong className="text-text">Today</strong>{" "}
                shows the decisions; <strong className="text-text">Cleanup</strong>{" "}
                groups the clutter;{" "}
                <strong className="text-text">Settings</strong> has the kill
                switch, the dry-run toggle, and the OpenAI key field.
              </p>
            </Step>

            <h2 className="mt-14 font-display text-[26px] font-semibold tracking-tightish text-text sm:text-[30px]">
              Troubleshooting
            </h2>
            <dl className="mt-5 space-y-5">
              <Troubleshoot q="The header has a red dot, or the panel says “sidecar not reachable.”">
                The helper isn&apos;t running, or its terminal got closed.
                Re-open the Step 3 terminal and run{" "}
                <code className="es-code">npm run server</code> again. The dot
                turns green within a second.
              </Troubleshoot>
              <Troubleshoot q="Chrome says “manifest is invalid” when I Load unpacked.">
                You probably selected the <code className="es-code">.zip</code>{" "}
                file or a wrapper folder. Re-select the inner folder — the one
                that contains <code className="es-code">manifest.json</code>{" "}
                directly.
              </Troubleshoot>
              <Troubleshoot q="The Settings tab says “no OpenAI key.”">
                Either paste your key into the{" "}
                <strong className="text-text">OpenAI API key</strong> field in
                Settings (forwarded to your local helper per request, never
                anywhere else), or stop the helper, set{" "}
                <code className="es-code">OPENAI_API_KEY=…</code> in{" "}
                <code className="es-code">.env</code>, and run{" "}
                <code className="es-code">npm run server</code> again.
              </Troubleshoot>
            </dl>

            <h2 className="mt-14 font-display text-[26px] font-semibold tracking-tightish text-text sm:text-[30px]">
              What this is <em>not</em>
            </h2>
            <ul className="mt-4 space-y-2 text-text-dim">
              <li>
                <strong className="text-text">No OAuth, no Gmail API, no Microsoft Graph.</strong>{" "}
                The extension reads the webmail DOM in your open tab — only
                what you can see.
              </li>
              <li>
                <strong className="text-text">No auto-send, no auto-delete, no auto-archive.</strong>{" "}
                Every action surfaces as an approval card; the policy gate
                hard-blocks destructive intents.
              </li>
              <li>
                <strong className="text-text">Dry-run is ON by default.</strong>{" "}
                Even after you approve an action, EmailSignal records it to the
                ledger but doesn&apos;t click anything until you flip Dry-Run
                off in Settings.
              </li>
              <li>
                <strong className="text-text">No EmailSignal server, no telemetry.</strong>{" "}
                The helper runs on your laptop; the only outbound traffic is
                to OpenAI, under your key.
              </li>
            </ul>

            <div className="mt-14 rounded-card border border-white/[0.08] bg-surface/60 p-6 text-center">
              <p className="text-[14px] text-text-dim">
                Once installed, the{" "}
                <Link
                  href="/"
                  className="text-accent-strong underline-offset-2 hover:underline"
                >
                  EmailSignal homepage
                </Link>{" "}
                has the rest of the story —{" "}
                <Link
                  href="/#safety"
                  className="text-accent-strong underline-offset-2 hover:underline"
                >
                  safety model
                </Link>
                ,{" "}
                <Link
                  href="/#time"
                  className="text-accent-strong underline-offset-2 hover:underline"
                >
                  time-awareness
                </Link>
                , and{" "}
                <Link
                  href="/#faq"
                  className="text-accent-strong underline-offset-2 hover:underline"
                >
                  FAQ
                </Link>
                .
              </p>
            </div>
          </article>
        </Container>
      </main>
      <Footer />
    </>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-[13px] font-semibold text-accent-strong">
          {number}
        </span>
        <h2 className="font-display text-[22px] font-semibold tracking-tightish text-text sm:text-[26px]">
          {title}
        </h2>
      </div>
      <div className="mt-3 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

function Troubleshoot({
  q,
  children,
}: {
  q: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-white/[0.06] bg-surface/50 p-5">
      <dt className="text-[14.5px] font-semibold text-text">{q}</dt>
      <dd className="mt-2 text-[14px] leading-relaxed text-text-dim">
        {children}
      </dd>
    </div>
  );
}
