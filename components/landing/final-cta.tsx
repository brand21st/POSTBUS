import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-ink py-20 sm:py-24">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-0 h-72 w-[520px] -translate-x-1/2 rounded-full bg-brand/30 blur-[110px]" />
        <svg className="absolute inset-0 h-full w-full opacity-40" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M0 180 C 180 120, 320 240, 520 160 S 860 80, 1200 170"
            fill="none"
            stroke="#E11D48"
            strokeOpacity="0.35"
            strokeWidth="1.5"
            strokeDasharray="6 10"
            className="animate-dash-flow"
          />
          <circle cx="220" cy="150" r="3" fill="#E11D48" fillOpacity="0.7" />
          <circle cx="540" cy="170" r="3" fill="#fff" fillOpacity="0.35" />
          <circle cx="860" cy="130" r="3" fill="#E11D48" fillOpacity="0.55" />
        </svg>
      </div>

      <Container className="relative text-center">
        <h2 className="section-title mx-auto max-w-3xl text-balance text-white">
          Make shipping the easiest part of your business.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-400">
          Connect your store. Automate your workflow. Ship with PostBus.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={siteConfig.getStartedUrl}
            className={cn(
              buttonVariants({ variant: "primary", size: "xl" }),
              "group w-full sm:w-auto"
            )}
          >
            Get Started
            <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href={siteConfig.bookDemoUrl}
            className={cn(
              buttonVariants({ variant: "dark-outline", size: "xl" }),
              "w-full sm:w-auto"
            )}
          >
            Book a Demo
          </Link>
        </div>
      </Container>
    </section>
  );
}
