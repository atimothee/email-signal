"use client";

import Link from "next/link";
import { Container } from "./Container";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";
import { WaitlistForm } from "./WaitlistForm";
import { SITE } from "@/lib/tokens";

const STEPS = [
  {
    n: "1",
    title: "Add EmailSignal to Chrome",
    body: "Download the latest build, unzip, and load it in Chrome (Developer mode). Two minutes, no terminal.",
  },
  {
    n: "2",
    title: "Open the EmailSignal helper",
    body: "A tiny free app that does the thinking on your own computer, so the email itself never lives on ours. Open it once and leave it running in the background.",
  },
  {
    n: "3",
    title: "Paste your AI key & open Gmail",
    body: "EmailSignal walks you through getting an OpenAI key (a 1-minute, copy-paste step). Then your Today list appears right next to your inbox.",
  },
];

export function GetStarted() {
  return (
    <section id="start" className="relative py-24 sm:py-32">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Get started"
            title={<>About 2 minutes. Three steps. No terminal.</>}
            lede="Setup is the part of these things that usually sucks. We made it as small as we honestly could."
          />
        </Reveal>

        <div className="mx-auto mt-14 grid max-w-5xl gap-4 sm:mt-20 md:grid-cols-3 md:gap-5">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08}>
              <div className="es-card relative h-full p-6">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-[13px] font-semibold text-accent-strong">
                    {s.n}
                  </span>
                  <span className="es-section-label">Step {s.n}</span>
                </div>
                <h3 className="mt-4 text-[16px] font-semibold leading-snug text-text">
                  {s.title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-text-dim">
                  {s.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1}>
          <p className="mx-auto mt-8 max-w-2xl text-center text-[12.5px] text-text-faint">
            Until our Chrome Web Store listing goes live, install takes about
            2 minutes —{" "}
            <Link
              href={SITE.installUrl}
              className="text-accent-strong underline-offset-2 hover:underline"
            >
              see the install guide
            </Link>
            .
          </p>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mx-auto mt-10 max-w-md">
            <WaitlistForm />
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
