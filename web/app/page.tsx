import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { TimeAwareness } from "@/components/TimeAwareness";
import { Safety } from "@/components/Safety";
import { Cleanup } from "@/components/Cleanup";
import { GetStarted } from "@/components/GetStarted";
import { FAQ } from "@/components/FAQ";
import { ClosingCTA } from "@/components/ClosingCTA";
import { Footer } from "@/components/Footer";
import { MobileNotice } from "@/components/MobileNotice";
import { SITE } from "@/lib/tokens";

export default function HomePage() {
  return (
    <>
      <Header />
      <main id="main" className="relative">
        <Hero />
        <section id="demo" aria-hidden className="-mt-16 sm:-mt-24" />
        <TimeAwareness />
        <Safety />
        <Cleanup />
        <GetStarted />
        <FAQ />
        <ClosingCTA />
      </main>
      <Footer />
      <MobileNotice />

      {/* Structured data for richer SEO. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "EmailSignal",
            applicationCategory: "BrowserApplication",
            operatingSystem: "Chrome (Desktop)",
            description:
              "A Chrome extension that reads only the Gmail you can see and turns the noise into a short list of decisions. Never sends or deletes. Open source.",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            url: SITE.url,
            installUrl: `${SITE.url}/install`,
          }),
        }}
      />
    </>
  );
}
