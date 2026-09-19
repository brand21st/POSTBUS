import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroBackground } from "@/components/product-ui/hero-background";
import { HeroShippingMockup } from "@/components/product-ui/hero-shipping-mockup";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-white pb-16 pt-10 sm:pb-20 sm:pt-14 lg:pb-28 lg:pt-16">
      <HeroBackground />
      <Container className="relative">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          <div>
            <p className="mb-5 inline-flex items-center rounded-full border border-brand/15 bg-brand/[0.06] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
              Ship smarter with PostBus
            </p>
            <h1 className="hero-title text-ink text-balance">
              Ship Every Shopify Order.
              <br />
              <span className="text-brand">Automatically.</span>
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted sm:text-xl">
              Connect your Shopify store and India Post account once. PostBus handles
              shipment booking, labels, manifests, tracking and fulfillment from one
              simple platform.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
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
                href="/#how-it-works"
                className={cn(
                  buttonVariants({ variant: "secondary", size: "xl" }),
                  "w-full sm:w-auto"
                )}
              >
                See How It Works
              </Link>
            </div>
            <p className="mt-5 text-sm font-medium text-muted">
              Built for Indian Shopify merchants
            </p>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 rounded-[36px] bg-brand/10 blur-2xl" aria-hidden />
            <HeroShippingMockup className="relative" />
          </div>
        </div>
      </Container>
    </section>
  );
}
