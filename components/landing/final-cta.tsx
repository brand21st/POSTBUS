import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-ink py-16 sm:py-24">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-0 h-72 w-[520px] -translate-x-1/2 rounded-full bg-brand/30 blur-[110px]" />
      </div>

      <Container className="relative text-center">
        <h2 className="section-title mx-auto max-w-3xl text-balance text-white">
          Keep shipping with India Post. Make the paperwork easier.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-400">
          Connect your Customer ID. Import Shopify or manual orders. Book, label and track from
          PostBus.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={siteConfig.getStartedUrl}
            className={cn(buttonVariants({ variant: "primary", size: "xl" }), "group w-full sm:w-auto")}
          >
            Start Free Trial
            <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/#how-it-works"
            className={cn(buttonVariants({ variant: "dark-outline", size: "xl" }), "w-full sm:w-auto")}
          >
            See How It Works
          </Link>
        </div>
      </Container>
    </section>
  );
}
