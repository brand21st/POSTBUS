import {
  Barcode,
  FileText,
  MapPin,
  Package,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const steps = [
  {
    number: "01",
    title: "Shopify Order",
    description: "New orders arrive from your connected store.",
    icon: ShoppingBag,
  },
  {
    number: "02",
    title: "PostBus Sync",
    description: "Orders sync into a clean shipping workspace.",
    icon: RefreshCw,
  },
  {
    number: "03",
    title: "India Post Booking",
    description: "Shipments are prepared through your workflow.",
    icon: Package,
  },
  {
    number: "04",
    title: "Label + Barcode",
    description: "Generate labels and manage barcode steps.",
    icon: Barcode,
  },
  {
    number: "05",
    title: "Manifest",
    description: "Create and organize manifests without switching tools.",
    icon: FileText,
  },
  {
    number: "06",
    title: "Tracking + Fulfillment",
    description: "Keep tracking organized and fulfillment updated.",
    icon: MapPin,
  },
] as const;

export function Workflow() {
  return (
    <section className="bg-surface py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          title={
            <>
              One connection.
              <br />
              One workflow.
              <br />
              Less manual work.
            </>
          }
          description="From Shopify order to India Post shipment — PostBus automates the workflow."
        />

        <div className="relative mt-16">
          <div
            className="pointer-events-none absolute left-0 right-0 top-[42px] hidden h-px bg-gradient-to-r from-transparent via-brand/30 to-transparent lg:block"
            aria-hidden
          />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {steps.map((step, index) => (
              <Reveal key={step.number} delay={index * 0.06}>
                <article className="relative rounded-[24px] border border-border bg-white p-5 card-shadow">
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                    <step.icon className="size-5" />
                  </div>
                  <p className="text-[11px] font-bold tracking-[0.16em] text-brand">
                    STEP {step.number}
                  </p>
                  <h3 className="mt-2 text-base font-semibold tracking-tight text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {step.description}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
