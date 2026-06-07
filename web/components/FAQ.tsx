"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Container } from "./Container";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";
import { cn } from "@/lib/cn";

type QA = { q: string; a: React.ReactNode };

const FAQS: QA[] = [
  {
    q: "Can it read my whole Google account?",
    a: (
      <>
        No. It only sees the Gmail tab you have open — the same thing your eyes
        see. There&apos;s no Google login, no OAuth, no Gmail API. The extension
        only has permission for <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px]">mail.google.com</code>;
        every other tab is invisible to it.
      </>
    ),
  },
  {
    q: "Will it ever send or delete an email?",
    a: (
      <>
        Never. It physically can&apos;t. The action types{" "}
        <span className="text-text">send</span>,{" "}
        <span className="text-text">reply</span>,{" "}
        <span className="text-text">forward</span>, and{" "}
        <span className="text-text">delete</span> are blocked by a policy gate
        in code that runs <em>after</em> any AI advice — so even a hallucinated
        instruction can&apos;t route around it.
      </>
    ),
  },
  {
    q: "Is my email being sent to some company&apos;s servers?",
    a: (
      <>
        No. EmailSignal runs on your own computer. The local helper app reads
        emails and sends short snippets (about 500 characters each, by default)
        to <strong className="text-text">OpenAI&apos;s API using your own key</strong> to do
        the synthesis. Nothing routes through us. There is no &quot;EmailSignal
        cloud&quot;.
      </>
    ),
  },
  {
    q: "Does it cost money?",
    a: (
      <>
        The app is free and open-source. You bring your own OpenAI key — that&apos;s
        the only running cost. For a typical inbox, classifying a day&apos;s mail is
        usually a few cents (often less than a quarter). You see your spend in
        OpenAI&apos;s own dashboard. We never see it.
      </>
    ),
  },
  {
    q: "What&apos;s an OpenAI key and how do I get one?",
    a: (
      <>
        Think of it as a tiny password that lets EmailSignal use OpenAI&apos;s
        models on your behalf. You make one for free at{" "}
        <a
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-strong underline-offset-2 hover:underline"
        >
          platform.openai.com
        </a>{" "}
        in about a minute. EmailSignal walks you through it the first time, and
        the key stays on your machine.
      </>
    ),
  },
  {
    q: "Does it work with Outlook?",
    a: <>Gmail today. Outlook support is on the roadmap, not in the build.</>,
  },
  {
    q: "What happens if there&apos;s nothing for me to do?",
    a: (
      <>
        It says so. <span className="text-text">&quot;Nothing pressing&quot;</span>{" "}
        is a real, valid answer — not a bug. We don&apos;t pad the list to look
        busy. If we did that, you&apos;d stop trusting us in a week.
      </>
    ),
  },
  {
    q: "Is it open source?",
    a: (
      <>
        Yes — every line. You can read what it does, fork it, run it locally
        without us at all, and{" "}
        <a
          href="https://github.com/atimothee/email-signal"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-strong underline-offset-2 hover:underline"
        >
          watch us build it on GitHub
        </a>
        .
      </>
    ),
  },
];

export function FAQ() {
  return (
    <section id="faq" className="relative border-t border-white/[0.04] bg-bg/40 py-24 sm:py-32">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Honest FAQ"
            title={<>The questions a careful person would actually ask.</>}
            lede="If we’re asking you to point an AI at your inbox, you deserve plain answers."
          />
        </Reveal>

        <div className="mx-auto mt-12 max-w-3xl divide-y divide-white/[0.06] rounded-card border border-white/[0.06] bg-surface/60 sm:mt-16">
          {FAQS.map((qa, i) => (
            <FaqItem key={qa.q} qa={qa} initiallyOpen={i === 0} />
          ))}
        </div>
      </Container>
    </section>
  );
}

function FaqItem({ qa, initiallyOpen }: { qa: QA; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(!!initiallyOpen);
  const reduced = useReducedMotion();
  return (
    <div className="px-5 sm:px-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 py-5 text-left"
        aria-expanded={open}
      >
        <span className="text-[15px] font-medium text-text">{qa.q}</span>
        <span
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 text-text-dim transition-transform",
            open && "rotate-45 bg-accent/20 text-accent-strong border-accent/30"
          )}
          aria-hidden
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-5 text-[14px] leading-relaxed text-text-dim">
              {qa.a}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
