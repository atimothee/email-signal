import { Container } from "./Container";
import { Wordmark } from "./BrandMark";
import { GitHubGlyph } from "./icons/Chrome";
import { SITE } from "@/lib/tokens";

export function Footer() {
  return (
    <footer className="border-t border-white/[0.05] bg-bg/60 py-14">
      <Container>
        <div className="grid gap-10 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Wordmark />
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-text-dim">
              A small, honest layer on top of Gmail and Outlook. Reads only
              what you can see. Never sends or deletes. Open source.
            </p>
            <a
              href={SITE.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-[12.5px] text-text-faint hover:text-text"
            >
              <GitHubGlyph size={14} />
              <span>github.com/atimothee/email-signal</span>
            </a>
          </div>

          <div>
            <p className="es-section-label !justify-start">Product</p>
            <ul className="mt-3 flex flex-col gap-2 text-[13px] text-text-dim">
              <li>
                <a href="#demo" className="hover:text-text">
                  See it
                </a>
              </li>
              <li>
                <a href="#time" className="hover:text-text">
                  Time-aware
                </a>
              </li>
              <li>
                <a href="#safety" className="hover:text-text">
                  Safety model
                </a>
              </li>
              <li>
                <a href="#start" className="hover:text-text">
                  Get started
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-text">
                  FAQ
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="es-section-label !justify-start">Open</p>
            <ul className="mt-3 flex flex-col gap-2 text-[13px] text-text-dim">
              <li>
                <a
                  href={SITE.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-text"
                >
                  Source code
                </a>
              </li>
              <li>
                <a
                  href={`${SITE.githubUrl}/blob/main/README.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-text"
                >
                  For developers →
                </a>
              </li>
              <li>
                <a
                  href={`${SITE.githubUrl}/blob/main/design-guidelines.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-text"
                >
                  Design guidelines
                </a>
              </li>
              <li>
                <a
                  href={`${SITE.githubUrl}/issues`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-text"
                >
                  Roadmap & issues
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="es-hr mt-12" />
        <div className="mt-6 flex flex-col items-start justify-between gap-3 text-[12px] text-text-faint sm:flex-row sm:items-center">
          <p>
            © {new Date().getFullYear()} EmailSignal. Built carefully, on purpose.
          </p>
          <p>
            Your email never lives on our servers — because we don&apos;t have
            servers that hold it.
          </p>
        </div>
      </Container>
    </footer>
  );
}
