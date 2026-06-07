"use client";

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useInView,
} from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  CLEANUP_SUMMARY,
  DAY_SUMMARY,
  DEMO_DECISIONS,
  DEMO_EMAILS,
  PAST_SUMMARY,
  TOTAL_UNREAD,
  type DemoEmail,
} from "@/lib/demo-data";
import { PulseDot } from "./PulseDot";
import { cn } from "@/lib/cn";

type Phase = "before" | "thinking" | "after";

const PHASE_DURATIONS: Record<Phase, number> = {
  before: 2200,
  thinking: 1300,
  after: 5500,
};

export function BeforeAfterDemo() {
  const reduced = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef, { amount: 0.4, once: false });

  const [phase, setPhase] = useState<Phase>("before");

  /** Auto-play loop, paused when off-screen. Honors reduced-motion. */
  useEffect(() => {
    if (reduced) {
      setPhase("after");
      return;
    }
    if (!inView) return;
    const t = setTimeout(() => {
      setPhase((p) =>
        p === "before" ? "thinking" : p === "thinking" ? "after" : "before"
      );
    }, PHASE_DURATIONS[phase]);
    return () => clearTimeout(t);
  }, [phase, inView, reduced]);

  const showAfter = phase === "after";
  const showThinking = phase === "thinking";

  return (
    <div ref={containerRef} className="relative">
      {/* Replay control — appears once "after" has been reached. */}
      <div className="absolute right-2 top-2 z-20 sm:right-4 sm:top-4">
        <button
          type="button"
          onClick={() => setPhase("before")}
          className={cn(
            "rounded-pill border border-white/10 bg-bg/60 px-3 py-1.5 text-[11px] font-medium text-text-dim backdrop-blur transition-colors hover:text-text hover:border-white/20",
            phase !== "after" && "opacity-0 pointer-events-none"
          )}
          aria-label="Replay demo"
        >
          ↻ Replay
        </button>
      </div>

      <div className="es-card overflow-hidden">
        {/* Mock browser chrome — sells "this is your Gmail tab" without faking
            a Google login. */}
        <div className="flex items-center gap-2 border-b border-white/[0.06] bg-bg/40 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
          <div className="ml-3 flex-1">
            <div className="mx-auto max-w-md rounded-md bg-surface-2 px-3 py-1 text-[11px] text-text-faint">
              mail.google.com/mail/u/0/#inbox
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <PulseDot
              tone={
                phase === "thinking"
                  ? "accent"
                  : phase === "after"
                    ? "success"
                    : "muted"
              }
            />
            <span className="text-[11px] text-text-faint">
              {phase === "thinking"
                ? "EmailSignal reading…"
                : phase === "after"
                  ? "EmailSignal ready"
                  : "EmailSignal idle"}
            </span>
          </div>
        </div>

        {/* Split view: Gmail (left/top) and the EmailSignal side panel (right/bottom). */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr]">
          {/* Gmail-ish surface */}
          <div className="border-b border-white/[0.05] bg-[#0c1424] p-3 sm:p-4 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-text-faint">
                  Inbox
                </span>
                <span
                  className={cn(
                    "es-chip text-[10px] transition-colors",
                    phase === "before"
                      ? "es-chip-danger"
                      : phase === "thinking"
                        ? "es-chip-warn"
                        : "es-chip-success"
                  )}
                  aria-live="polite"
                >
                  {phase === "before"
                    ? `${TOTAL_UNREAD} unread`
                    : phase === "thinking"
                      ? "Reading…"
                      : "3 to decide · 61 to tidy"}
                </span>
              </div>
              <span className="hidden sm:inline text-[11px] text-text-faint">
                you · primary
              </span>
            </div>

            <div
              className="relative max-h-[460px] min-h-[320px] overflow-hidden rounded-card border border-white/[0.04] bg-[#0a1120] p-1.5"
              aria-hidden={showAfter}
            >
              <AnimatePresence initial={false}>
                {DEMO_EMAILS.map((email, i) => {
                  const removed = showAfter && email.bucket !== "decision-1";
                  // The hero rows we "promote" while thinking: stay put, get a glow.
                  const promoting =
                    showThinking &&
                    (email.bucket === "decision-1" ||
                      email.bucket === "decision-2" ||
                      email.bucket === "decision-3");
                  const collapsing = showThinking && email.bucket === "cleanup";
                  return (
                    <EmailRow
                      key={email.id}
                      email={email}
                      index={i}
                      promoting={promoting}
                      collapsing={collapsing}
                      removed={removed}
                      phase={phase}
                    />
                  );
                })}
              </AnimatePresence>

              {/* Fade mask at the bottom to suggest "there's more". */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0a1120] to-transparent" />
            </div>
          </div>

          {/* EmailSignal panel */}
          <div className="relative bg-bg/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PulseDot
                  tone={
                    phase === "thinking"
                      ? "accent"
                      : phase === "after"
                        ? "success"
                        : "muted"
                  }
                />
                <span className="text-[12px] font-semibold uppercase tracking-wider text-text-faint">
                  Today
                </span>
              </div>
              <span className="text-[11px] text-text-faint">
                EmailSignal · synthesis
              </span>
            </div>

            <div className="relative min-h-[420px] sm:min-h-[460px]">
              {/* Idle / pre-read state */}
              <AnimatePresence>
                {phase === "before" && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    className="flex h-[420px] flex-col items-center justify-center text-center"
                  >
                    <div className="relative h-16 w-16">
                      <span className="absolute inset-0 rounded-full bg-accent/15 animate-breathe" />
                      <span className="absolute inset-3 rounded-full bg-accent/40 animate-breathe" />
                      <span className="absolute inset-5 rounded-full bg-accent" />
                    </div>
                    <p className="mt-5 text-[14px] font-medium text-text">
                      Ready when you are
                    </p>
                    <p className="mt-1.5 text-[12px] text-text-dim">
                      Open Gmail. I&apos;ll read what you see and pull the few
                      things that need you.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Thinking */}
              <AnimatePresence>
                {phase === "thinking" && (
                  <motion.div
                    key="thinking"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35 }}
                    className="flex h-[420px] flex-col items-center justify-center text-center"
                  >
                    <ThinkingPulse />
                    <p className="mt-5 text-[14px] font-medium text-text">
                      Reading your inbox…
                    </p>
                    <p className="mt-1.5 text-[12px] text-text-dim">
                      Folding related threads, dropping the noise.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* After — the short list of decisions */}
              <AnimatePresence>
                {phase === "after" && (
                  <motion.div
                    key="after"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="flex flex-col gap-3"
                  >
                    {/* Honest one-line day summary. */}
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35 }}
                      className="rounded-card bg-accent/[0.08] border border-accent/20 px-3.5 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="es-section-label !text-accent-strong/80">
                          Your day
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] leading-snug text-text">
                        {DAY_SUMMARY}
                      </p>
                    </motion.div>

                    {/* The 3 decision cards. */}
                    <div className="flex flex-col gap-2.5">
                      <SectionMicroLabel
                        left="Decide today"
                        rightCount={DEMO_DECISIONS.length}
                      />
                      {DEMO_DECISIONS.map((d, i) => (
                        <motion.div
                          key={d.id}
                          initial={{ opacity: 0, y: 8, scale: 0.985 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{
                            delay: 0.15 + i * 0.12,
                            type: "spring",
                            stiffness: 340,
                            damping: 28,
                          }}
                          className="es-card-2 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-[13.5px] font-semibold leading-snug text-text">
                              {d.title}
                            </p>
                            {d.meta && (
                              <span className="shrink-0 text-[11px] text-text-faint">
                                {d.meta}
                              </span>
                            )}
                          </div>
                          <p className="mt-1.5 text-[12px] leading-relaxed text-text-dim">
                            {d.why}
                          </p>
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            {d.badges.map((b) => (
                              <span
                                key={b.label}
                                className={cn(
                                  "es-chip",
                                  b.tone === "warn" && "es-chip-warn",
                                  b.tone === "danger" && "es-chip-danger",
                                  b.tone === "accent" && "es-chip-accent",
                                  b.tone === "success" && "es-chip-success"
                                )}
                              >
                                {b.label}
                              </span>
                            ))}
                            <span className="ml-auto text-[10.5px] uppercase tracking-wider text-text-faint">
                              {d.source.count} email
                              {d.source.count === 1 ? "" : "s"} ·{" "}
                              {d.source.label}
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {/* Collapsed cleanup line. */}
                    <motion.button
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.55 }}
                      className="group flex items-center justify-between gap-3 rounded-card border border-white/[0.05] bg-surface-2/60 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2"
                    >
                      <span className="text-[13px] text-text">
                        <span className="font-medium">
                          {CLEANUP_SUMMARY.count} {CLEANUP_SUMMARY.label}
                        </span>{" "}
                        <span className="text-text-dim">
                          — {CLEANUP_SUMMARY.cta}
                        </span>
                      </span>
                      <span className="es-chip text-text-dim group-hover:text-text">
                        Review →
                      </span>
                    </motion.button>

                    {/* Past / handled. */}
                    <motion.button
                      type="button"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.7 }}
                      className="flex items-center justify-between gap-3 rounded-card px-3.5 py-2 text-left"
                    >
                      <span className="text-[12px] text-text-faint">
                        {PAST_SUMMARY.count} {PAST_SUMMARY.label} —{" "}
                        <span className="italic">{PAST_SUMMARY.hint}</span>
                      </span>
                      <span className="text-[11px] text-text-faint underline-offset-2 hover:underline">
                        Show
                      </span>
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Caption — "the aha" */}
        <div className="border-t border-white/[0.05] bg-bg/40 px-4 py-3 sm:px-6">
          <p className="text-center text-[12.5px] text-text-dim">
            <span className="text-text">
              Two recruiters waiting on you? That&apos;s{" "}
              <span className="font-semibold text-accent-strong">one</span>{" "}
              decision, not two emails.
            </span>{" "}
            Newsletters? One sweep. The viewing on Saturday? Held up so you
            don&apos;t miss it.
          </p>
        </div>
      </div>
    </div>
  );
}

function SectionMicroLabel({
  left,
  rightCount,
}: {
  left: string;
  rightCount: number;
}) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-faint">
        {left}
      </span>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-faint">
        {rightCount}
      </span>
    </div>
  );
}

function ThinkingPulse() {
  return (
    <div className="relative h-16 w-16">
      <span className="absolute inset-0 rounded-full border border-accent/40 animate-pulse-ring" />
      <span
        className="absolute inset-0 rounded-full border border-accent/40 animate-pulse-ring"
        style={{ animationDelay: "0.6s" }}
      />
      <span className="absolute inset-4 rounded-full bg-accent/30 animate-breathe" />
      <span className="absolute inset-6 rounded-full bg-accent shadow-[0_0_30px_rgb(var(--accent)/0.6)]" />
    </div>
  );
}

function EmailRow({
  email,
  index,
  promoting,
  collapsing,
  removed,
  phase,
}: {
  email: DemoEmail;
  index: number;
  promoting: boolean;
  collapsing: boolean;
  removed: boolean;
  phase: Phase;
}) {
  if (removed) return null;
  const isDecision =
    email.bucket === "decision-1" ||
    email.bucket === "decision-2" ||
    email.bucket === "decision-3";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{
        opacity: collapsing ? 0.35 : 1,
        y: 0,
        scale: promoting ? 1.005 : 1,
      }}
      exit={{ opacity: 0, x: 30, transition: { duration: 0.25 } }}
      transition={{
        delay: phase === "before" ? Math.min(index * 0.02, 0.35) : 0,
        duration: 0.35,
      }}
      className={cn(
        "group relative flex items-center gap-3 rounded-[10px] px-3 py-2 transition-colors",
        promoting && "bg-accent/[0.08] ring-1 ring-accent/30",
        !promoting && "hover:bg-white/[0.03]",
        email.unread && "font-medium text-text",
        !email.unread && "text-text-dim"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          email.unread ? "bg-accent" : "bg-transparent"
        )}
        aria-hidden
      />
      <span className="w-24 shrink-0 truncate text-[12.5px] sm:w-32">
        {email.sender}
      </span>
      <span className="flex-1 truncate text-[12.5px]">
        <span className={cn(email.promo && "text-text-dim")}>
          {email.promo && (
            <span className="mr-1.5 align-middle es-chip !py-0 !px-1.5 !text-[9.5px] text-text-faint">
              promo
            </span>
          )}
          {email.subject}
        </span>
        <span className="ml-2 text-text-faint">— {email.snippet}</span>
      </span>
      <span className="hidden shrink-0 text-[11px] text-text-faint md:inline">
        {email.receivedAt}
      </span>
      {isDecision && phase === "thinking" && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white shadow-glow"
        >
          ✓
        </motion.span>
      )}
    </motion.div>
  );
}
