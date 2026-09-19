import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/utils";

export function PricingPreview() {
  return (
    <section className="bg-white py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          title={
            <>
              Simple shipping software.
              <br />
              Built to grow with you.
            </>
          }
          description="Plans designed for growing Shopify businesses."
        />
        <div className="mx-auto mt-12 max-w-3xl rounded-[28px] border border-border bg-surface p-8 text-center card-shadow sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand">
            Pricing
          </p>
          <p className="mt-4 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            Choose a plan that matches your shipping volume and team.
          </p>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            We keep pricing straightforward. View current plan options and talk to us
            about what fits your store.
          </p>
          <Link
            href="/pricing"
            className={cn(
              buttonVariants({ variant: "primary", size: "lg" }),
              "group mt-8 inline-flex"
            )}
          >
            View Pricing
            <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </Container>
    </section>
  );
}
