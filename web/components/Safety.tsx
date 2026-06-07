"use client";

import { Container } from "./Container";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";
import { motion, useReducedMotion } from "framer-motion";

const GUARANTEES = [
  {
    title: "Never sends, replies, forwards, or deletes.",
    body: "These action types are hard-blocked in code — not a setting you can flip off by accident.",
  },
  {
    title: "Every action is an approval card.",
    body: "You see exactly what will happen before it happens. Approve, skip, or correct it. No bulk-approve-forever.",
  },
  {
    title: "Dry run is on by default.",
    body: "Even after you approve, nothing actually clicks until you flip the switch. Until then it just logs what it would have done.",
  },
  {
    title: "One-click kill switch.",
    body: "Stops every agent mid-turn. Right there in Settings, never buried.",
  },
  {
    title: "Unsubscribes open in a new tab — never auto-submit.",
    body: "It opens the link with safe browser flags. You decide whether to confirm. No forms entered, no credentials touched.",
  },
  {
    title: "No Google or Microsoft login. No OAuth. No Gmail API or Graph.",
    body: "It reads the Gmail or Outlook web page you have open, the same way you do. Your account and credentials never leave your browser.",
  },
];

export function Safety() {
  return (
    <section
      id="safety"
      className="relative border-y border-white/[0.04] bg-bg/40 py-24 sm:py-32"
    >
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Trust by design"
            title={<>You&apos;re always the one who clicks.</>}
            lede="The whole product assumes the first thing that goes wrong is the agent doing something you didn’t mean. So the agent doesn’t do anything you didn’t mean."
          />
        </Reveal>

        <div className="mx-auto mt-16 grid max-w-5xl items-start gap-10 sm:mt-20 lg:grid-cols-[1.05fr_1fr]">
          <Reveal>
            <ApprovalCard />
          </Reveal>

          <div className="flex flex-col gap-4">
            {GUARANTEES.map((g, i) => (
              <Reveal key={g.title} delay={i * 0.05}>
                <div className="flex items-start gap-3">
                  <Check />
                  <div>
                    <p className="text-[14.5px] font-medium leading-snug text-text">
                      {g.title}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-text-dim">
                      {g.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}

function Check() {
  return (
    <span
      aria-hidden
      className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-strong"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <path
          d="M4.5 12.5l4.5 4.5 10.5-11"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function ApprovalCard() {
  const reduced = useReducedMotion();
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-6 -z-10 rounded-card bg-[radial-gradient(60%_60%_at_50%_30%,rgb(var(--accent)/0.18),transparent_70%)]"
      />
      <div className="es-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-bg/40 px-4 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint">
            Decide now · 1
          </span>
          <span className="es-chip es-chip-warn text-[10.5px]">
            Dry run · on
          </span>
        </div>

        <div className="p-5">
          <h3 className="text-[15px] font-semibold text-text">
            Unsubscribe from <span className="text-accent-strong">Substack Daily</span>
          </h3>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="es-chip">Risk: low</span>
            <span className="es-chip">Reversible (one click)</span>
            <span className="es-chip es-chip-accent">High confidence</span>
          </div>

          <p className="mt-4 text-[13px] leading-relaxed text-text-dim">
            You marked Substack Daily as clutter twice this week. Want to stop
            seeing it?
          </p>

          <div className="mt-4 rounded-card border border-white/[0.06] bg-surface-2/70 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-strong/90">
              If you approve
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-text">
              I&apos;ll open Substack&apos;s unsubscribe link in a new tab. You&apos;ll
              click confirm yourself — I never auto-submit forms.
            </p>
          </div>

          <div className="mt-4 rounded-card border border-white/[0.06] bg-surface-2/40 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">
              Why shown
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">
              Substack Daily has been in your last 3 cleanup batches.
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <motion.button
              whileTap={reduced ? undefined : { scale: 0.97 }}
              className="es-btn !px-4 !py-2 !text-[13px]"
              type="button"
            >
              Approve once
            </motion.button>
            <button
              type="button"
              className="rounded-pill border border-danger/20 bg-danger/[0.08] px-4 py-2 text-[13px] font-medium text-danger transition-colors hover:bg-danger/[0.14]"
            >
              Skip
            </button>
            <button
              type="button"
              className="ml-auto text-[12px] text-text-faint hover:text-text"
            >
              That&apos;s not right
            </button>
          </div>

          <div className="mt-3.5 flex items-center justify-between text-[11px] text-text-faint">
            <span>Keep suggesting · Stop suggesting</span>
            <span>Proposed by Cleanup Scout</span>
          </div>
        </div>
      </div>
    </div>
  );
}
