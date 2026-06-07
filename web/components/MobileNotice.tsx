"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const KEY = "es-mobile-notice-dismissed-v1";

/**
 * EmailSignal is a desktop Chrome extension. Most people will discover this
 * page on a phone and then install on a laptop. This banner gives them an
 * obvious next step instead of leaving them on a dead end.
 */
export function MobileNotice() {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem(KEY);
    const isPhone = window.matchMedia("(max-width: 767px)").matches;
    if (isPhone && !dismissed) setVisible(true);
  }, []);

  function dismiss() {
    window.localStorage.setItem(KEY, "1");
    setVisible(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — silent. */
    }
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="fixed inset-x-3 bottom-3 z-50 md:hidden"
          role="status"
        >
          <div className="es-card flex items-start gap-3 p-4 backdrop-blur">
            <div className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-strong">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect
                  x="6"
                  y="2"
                  width="12"
                  height="20"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <circle cx="12" cy="18" r="0.8" fill="currentColor" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium leading-snug text-text">
                Heads up — EmailSignal is a desktop Chrome extension.
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-text-dim">
                Save this page and open it on your laptop in Chrome to install.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={copyLink}
                  className="rounded-pill bg-accent/15 px-3 py-1.5 text-[12px] font-medium text-accent-strong"
                >
                  {copied ? "Link copied ✓" : "Copy link"}
                </button>
                <button
                  onClick={dismiss}
                  className="text-[12px] text-text-faint hover:text-text"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
