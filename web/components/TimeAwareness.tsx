"use client";

import { Container } from "./Container";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

type Card = {
  kind: "rising" | "demoted" | "future";
  badge: { label: string; tone: "warn" | "danger" | "accent" | "muted" };
  title: string;
  meta: string;
  why: string;
  highlight: string;
};

const CARDS: Card[] = [
  {
    kind: "rising",
    badge: { label: "Overdue", tone: "danger" },
    title: "Pay the $240 ConEd bill",
    meta: "Final notice landed 14 days ago",
    why: "Bills get more urgent with age, not less. This one is being held high until you mark it done.",
    highlight: "Rises with age",
  },
  {
    kind: "future",
    badge: { label: "This week", tone: "accent" },
    title: "Confirm apartment viewing — Sat 2pm",
    meta: "Booked back in April",
    why: "An email from months ago about a moment that's almost here is the most important kind of email.",
    highlight: "Anchors to the date — not the inbox",
  },
  {
    kind: "demoted",
    badge: { label: "Likely handled", tone: "muted" },
    title: "Coffee with Anh — Mon May 22, 10am",
    meta: "From ~3 weeks ago",
    why: "Past meeting, no follow-up since. Tucked away — not deleted — in a collapsed group so it never blocks today.",
    highlight: "Quietly demoted, never lost",
  },
];

export function TimeAwareness() {
  return (
    <section id="time" className="relative py-24 sm:py-32">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Time-aware, on purpose"
            title={
              <>
                Recent isn&apos;t the same as important.
                <br className="hidden sm:block" /> It knows the difference.
              </>
            }
            lede="A bill from six weeks ago gets more urgent with age. A viewing that already happened gets quietly tucked away. Your inbox doesn’t reason about time — EmailSignal does."
          />
        </Reveal>

        <div className="mx-auto mt-14 grid max-w-5xl gap-4 sm:mt-20 sm:grid-cols-3 sm:gap-5">
          {CARDS.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.08}>
              <TimeCard card={c} />
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

function TimeCard({ card }: { card: Card }) {
  const reduced = useReducedMotion();
  return (
    <div className="es-card relative h-full overflow-hidden p-5">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "es-chip",
            card.badge.tone === "danger" && "es-chip-danger",
            card.badge.tone === "warn" && "es-chip-warn",
            card.badge.tone === "accent" && "es-chip-accent"
          )}
        >
          {card.badge.label}
        </span>
        <span className="text-[10.5px] uppercase tracking-wider text-text-faint">
          {card.kind === "rising"
            ? "↑ rising"
            : card.kind === "demoted"
              ? "↓ demoted"
              : "→ held"}
        </span>
      </div>

      <h3 className="mt-4 text-[15px] font-semibold leading-snug text-text">
        {card.title}
      </h3>
      <p className="mt-1 text-[12px] text-text-faint">{card.meta}</p>
      <p className="mt-3 text-[13px] leading-relaxed text-text-dim">
        {card.why}
      </p>

      <div className="mt-5 rounded-card border border-white/[0.05] bg-surface-2/60 px-3 py-2.5">
        <p className="text-[12px] font-medium text-text">{card.highlight}</p>
        {/* Tiny illustrative bar showing the urgency curve. */}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <motion.span
            initial={reduced ? false : { width: 0 }}
            whileInView={{
              width:
                card.kind === "rising"
                  ? "92%"
                  : card.kind === "future"
                    ? "70%"
                    : "18%",
            }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "block h-full rounded-full",
              card.kind === "rising" && "bg-danger",
              card.kind === "future" && "bg-accent",
              card.kind === "demoted" && "bg-text-faint/50"
            )}
          />
        </div>
      </div>
    </div>
  );
}
