import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main id="main-content" className="flex min-h-screen items-center bg-surface py-20">
      <Container className="max-w-2xl text-center">
        <Logo className="justify-center" />
        <p className="mt-12 text-sm font-bold uppercase tracking-[0.18em] text-brand">
          404 · Page not found
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          This route has left the depot.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted">
          The page may have moved or the address may be incorrect. Return to PostBus to
          learn how ecommerce teams manage India Post orders, labels and tracking.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className={cn(buttonVariants({ variant: "primary", size: "lg" }), "rounded-full")}
          >
            Go to homepage
          </Link>
          <Link
            href="/contact"
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "rounded-full")}
          >
            Contact support
          </Link>
        </div>
      </Container>
    </main>
  );
}
