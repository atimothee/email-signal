"use client";

import { useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Status = "idle" | "submitting" | "ok" | "error";

export function WaitlistForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      setError("That doesn’t look like an email — mind a second look?");
      return;
    }
    setStatus("submitting");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Network");
      setStatus("ok");
    } catch {
      setStatus("error");
      setError("Hmm — that didn’t go through. Try again in a sec?");
    }
  }

  return (
    <div id="waitlist" className="es-card p-5 text-center">
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent-strong/90">
        Or get notified
      </p>
      <p className="mt-2 text-[14.5px] text-text">
        Drop your email and we&apos;ll ping you the day install becomes
        one-click.
      </p>

      <AnimatePresence mode="wait" initial={false}>
        {status === "ok" ? (
          <motion.div
            key="ok"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 rounded-card bg-success/[0.1] border border-success/20 px-4 py-3 text-[13px] text-success"
          >
            You&apos;re on the list — thanks. We&apos;ll keep it short.
          </motion.div>
        ) : (
          <motion.form
            key="form"
            initial={false}
            onSubmit={onSubmit}
            className="mt-4 flex flex-col gap-2 sm:flex-row"
          >
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status === "submitting"}
              className="flex-1 rounded-pill border border-white/[0.08] bg-bg/60 px-4 py-2.5 text-[14px] text-text outline-none placeholder:text-text-faint focus:border-accent/60 focus:bg-bg"
            />
            <button
              type="submit"
              disabled={status === "submitting"}
              className="es-btn !py-2.5 !text-[13px] disabled:opacity-70"
            >
              {status === "submitting" ? "Sending…" : "Notify me"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      {error && (
        <p className="mt-2 text-left text-[12px] text-danger">{error}</p>
      )}
      <p className="mt-3 text-[11px] text-text-faint">
        No marketing list, no third parties. One email when it&apos;s ready.
      </p>
    </div>
  );
}
