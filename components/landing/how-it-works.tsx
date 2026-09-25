import Link from "next/link";
import { ArrowRight, IdCard, Package, Printer, ShoppingBag } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

const steps = [
  {
    number: "01",
    title: "Connect your India Post Customer ID",
    description:
      "Use the same Customer ID, password, service contracts, barcode range and pickup office you already use with India Post.",
    icon: IdCard,
  },
  {
    number: "02",
    title: "Bring orders into one workspace",
    description:
      "Import Shopify orders or add manual shipments. You do not need to change courier or rebuild your store.",
    icon: ShoppingBag,
  },
  {
    number: "03",
    title: "Book, label and manifest",
    description:
      "Prepare India Post shipments, generate labels and organize manifests from PostBus instead of repeating portal work.",
    icon: Printer,
  },
  {
    number: "04",
    title: "Track without extra tabs",
    description:
      "Keep AWB status, delivery updates and shipment history in the same dashboard your team already uses to book.",
    icon: Package,
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-surface py-14 sm:py-20 lg:py-24">
      <Container>
        <SectionHeading
          eyebrow="How it works"
          title="Keep India Post. Stop the manual shipping grind."
          description="You already ship with India Post. PostBus sits on top of that account so booking, labels and tracking happen in one place."
        />
        <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <article
              key={step.number}
              className="rounded-[24px] border border-border bg-white p-5 sm:p-6"
            >
              <div className="mb-4 inline-flex size-11 items-center justify-center rounded-2xl bg-brand text-white">
                <step.icon className="size-5" aria-hidden="true" />
              </div>
              <p className="text-[11px] font-bold tracking-[0.16em] text-brand">STEP {step.number}</p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight text-ink">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.description}</p>
            </article>
          ))}
        </div>
        <div className="mt-8 flex justify-center">
          <Link
            href={siteConfig.getStartedUrl}
            className={cn(buttonVariants({ variant: "primary", size: "lg" }), "rounded-full")}
          >
            Start Free Trial
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </Container>
    </section>
  );
}
