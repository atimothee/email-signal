"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Container } from "./Container";
import { CtaButton } from "./CtaButton";
import { PulseDot } from "./PulseDot";
import { BeforeAfterDemo } from "./BeforeAfterDemo";

export function Hero() {
  const reduced = useReducedMotion();
  return (
    <section className="relative pt-10 pb-16 sm:pt-16 sm:pb-24">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6 inline-flex items-center gap-2 rounded-pill border border-white/[0.08] bg-surface/60 px-3 py-1.5 text-[12px] text-text-dim backdrop-blur"
          >
            <PulseDot tone="accent" />
            <span>
              For Gmail · Reads what you can see · Never sends or deletes
            </span>
          </motion.div>

          <motion.h1
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="text-balance font-display text-[42px] font-semibold leading-[1.05] tracking-tighter2 text-text sm:text-[58px] sm:leading-[1.04] lg:text-[72px]"
          >
            The few things that need you{" "}
            <span className="es-shimmer-text">today</span>. Nothing else.
          </motion.h1>

          <motion.p
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mx-auto mt-6 max-w-xl text-balance text-[16px] leading-relaxed text-text-dim sm:text-[18px]"
          >
            EmailSignal reads the Gmail you have open and turns 80-something
            unread into a short list of decisions — in your own voice, with the
            why and the next step attached.
          </motion.p>

          <motion.div
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
          >
            <CtaButton />
            <CtaButton href="#demo" variant="ghost">
              See it in motion ↓
            </CtaButton>
          </motion.div>

          <motion.p
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-5 text-[12.5px] text-text-faint"
          >
            No Google login. No access to your account. Runs on your own
            machine.
          </motion.p>
        </div>

        <motion.div
          initial={reduced ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto mt-14 max-w-5xl sm:mt-20"
        >
          {/* Subtle glow under the demo card. */}
          <div
            aria-hidden
            className="absolute -inset-x-10 -top-10 bottom-0 -z-10 bg-[radial-gradient(80%_60%_at_50%_30%,rgb(var(--accent)/0.18),transparent_70%)]"
          />
          <BeforeAfterDemo />
        </motion.div>
      </Container>
    </section>
  );
}
