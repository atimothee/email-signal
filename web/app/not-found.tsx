import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

export default function NotFound() {
  return (
    <main className="relative flex min-h-[80vh] items-center justify-center px-6">
      <div className="relative z-10 text-center">
        <BrandMark size={56} className="mx-auto" />
        <h1 className="mt-6 font-display text-[40px] font-semibold tracking-tighter2 text-text">
          Nothing pressing here.
        </h1>
        <p className="mt-3 text-[16px] text-text-dim">
          That page either moved or never existed. Honestly, we&apos;re not
          sure which.
        </p>
        <Link
          href="/"
          className="es-btn mt-7 inline-flex"
        >
          Back to EmailSignal
        </Link>
      </div>
    </main>
  );
}
