"use client";

import { Container } from "./Container";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";
import { WaitlistForm } from "./WaitlistForm";
import { SITE } from "@/lib/tokens";

const STEPS = [
  {
    n: "1",
    title: "Add EmailSignal to Chrome",
    body: "One click from the Chrome Web Store. It only has permission for your Gmail tab — nothing else.",
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
          <div className="mx-auto mt-10 max-w-2xl rounded-card border border-warn/20 bg-warn/[0.06] p-4 text-center text-[12.5px] text-text-dim">
            <p>
              <span className="font-medium text-warn">Heads up — pre-launch.</span>{" "}
              The Chrome Web Store listing and the one-click helper app are on
              the way. Today the helper still needs a quick command on your
              machine.{" "}
              <a
                href={SITE.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-strong underline-offset-2 hover:underline"
              >
                For developers, the README has the full path →
              </a>
            </p>
          </div>
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
