"use client";

import { Container } from "./Container";
import { Reveal } from "./Reveal";
import { CtaButton } from "./CtaButton";

export function ClosingCTA() {
  return (
    <section className="relative py-24 sm:py-32">
      <Container>
        <Reveal>
          <div className="relative mx-auto max-w-3xl overflow-hidden rounded-[24px] border border-white/[0.08] bg-surface/70 px-6 py-16 text-center sm:px-12 sm:py-20">
            <div
              aria-hidden
              className="absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_20%,rgb(var(--accent)/0.18),transparent_70%)]"
            />
            <h2 className="text-balance font-display text-[32px] font-semibold leading-tight tracking-tightish text-text sm:text-[44px]">
              Open your inbox and already know you&apos;re on top of it.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-balance text-[15.5px] text-text-dim sm:text-[17px]">
              Less reading, more deciding. And on the days nothing&apos;s on
              fire, EmailSignal will just say so.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <CtaButton />
              <CtaButton href="#start" variant="ghost">
                See the 3-step setup
              </CtaButton>
            </div>
            <p className="mt-5 text-[12px] text-text-faint">
              Free · Open source · No Google login · No emails leave your
              machine except short snippets to OpenAI via your own key.
            </p>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
