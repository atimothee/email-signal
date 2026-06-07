"use client";

import { Container } from "./Container";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

type Group = {
  brand: string;
  count: number;
  category: "Newsletter" | "Promo" | "Notification" | "Social";
};

const GROUPS: Group[] = [
  { brand: "Substack Daily", count: 14, category: "Newsletter" },
  { brand: "LinkedIn", count: 11, category: "Notification" },
  { brand: "Allbirds", count: 7, category: "Promo" },
  { brand: "Morning Brew", count: 6, category: "Newsletter" },
  { brand: "Headspace", count: 5, category: "Notification" },
  { brand: "Spotify", count: 4, category: "Notification" },
  { brand: "Doordash", count: 4, category: "Promo" },
  { brand: "Notion Updates", count: 3, category: "Newsletter" },
];

export function Cleanup() {
  return (
    <section id="cleanup" className="relative py-24 sm:py-32">
      <Container>
        <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
          <Reveal>
            <SectionHeading
              align="left"
              eyebrow="Cleanup"
              title={
                <>
                  And the 61 newsletters?
                  <br className="hidden sm:block" /> One tidy sweep.
                </>
              }
              lede="Newsletters, promos, and notifications never get to be ‘decisions’. They flow to a separate Cleanup surface, grouped by sender so you can sweep a whole pile in one approval — and undo it if you change your mind."
            />
            <div className="mt-7 flex flex-col gap-3 text-[14px] text-text-dim">
              <Bullet>
                Mark-read, archive, or unsubscribe — never delete, never
                permanent.
              </Bullet>
              <Bullet>
                Unsubscribe opens the brand&apos;s own link, in a new tab. You
                click confirm.
              </Bullet>
              <Bullet>
                Every sweep is one approval card. Per-row toggles before you
                hit go.
              </Bullet>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <CleanupSweep groups={GROUPS} />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden
        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
      />
      <span>{children}</span>
    </div>
  );
}

function CleanupSweep({ groups }: { groups: Group[] }) {
  const reduced = useReducedMotion();
  const total = groups.reduce((acc, g) => acc + g.count, 0);
  return (
    <div className="es-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-bg/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="es-section-label">Cleanup</span>
          <span className="es-chip">{total} in 8 senders</span>
        </div>
        <button
          type="button"
          className="es-btn !px-3.5 !py-1.5 !text-[12px]"
        >
          Sweep all (with review)
        </button>
      </div>

      <div className="flex flex-col gap-2 p-3.5">
        {groups.map((g, i) => (
          <motion.div
            key={g.brand}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ delay: i * 0.04, duration: 0.4 }}
            className="flex items-center justify-between gap-3 rounded-card border border-white/[0.04] bg-surface-2/50 px-3.5 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Avatar brand={g.brand} />
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium text-text">
                  {g.brand}
                </p>
                <p className="text-[11.5px] text-text-faint">
                  {g.category} · {g.count} in inbox
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="es-chip text-[10.5px] text-text-faint hover:text-text cursor-pointer">
                Mark read
              </span>
              <span className="es-chip text-[10.5px] text-text-faint hover:text-text cursor-pointer">
                Archive
              </span>
              <span className="es-chip es-chip-accent text-[10.5px] cursor-pointer">
                Unsubscribe
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="border-t border-white/[0.05] bg-bg/40 px-4 py-3 text-center text-[12px] text-text-faint">
        Every sweep is reversible. Mark-read can be undone with one click; an
        archive moves the thread, never destroys it.
      </div>
    </div>
  );
}

function Avatar({ brand }: { brand: string }) {
  const initials = brand
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  // Stable colour from the brand string so the avatars feel "real" without
  // hard-coding 8 palettes.
  let hash = 0;
  for (let i = 0; i < brand.length; i++) hash = (hash * 31 + brand.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white"
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue + 40) % 360} 65% 42%))`,
      }}
    >
      {initials}
    </span>
  );
}
