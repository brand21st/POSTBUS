import { Link2, Settings2, Truck } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const steps = [
  {
    number: "01",
    title: "Connect",
    description: "Connect your Shopify store and India Post shipping setup.",
    icon: Link2,
  },
  {
    number: "02",
    title: "Automate",
    description: "Choose which shipping operations PostBus should handle automatically.",
    icon: Settings2,
  },
  {
    number: "03",
    title: "Ship",
    description:
      "Process orders, generate labels, create manifests and keep tracking organized.",
    icon: Truck,
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-white py-20 sm:py-24 lg:py-28">
      <Container>
        <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <SectionHeading
              align="left"
              eyebrow="How it works"
              title="Start shipping in minutes."
              description="Connect once. Configure your workflow. Let PostBus handle the repetitive shipping steps."
            />
            <div className="mt-10 space-y-5">
              {steps.map((step, index) => (
                <Reveal key={step.number} delay={index * 0.08}>
                  <div className="flex gap-4 rounded-[24px] border border-border bg-surface p-5">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-white">
                      <step.icon className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold tracking-[0.16em] text-brand">
                        {step.number}
                      </p>
                      <h3 className="mt-1 text-xl font-semibold text-ink">{step.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted">
                        {step.description}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          <Reveal>
            <div className="relative overflow-hidden rounded-[28px] border border-border bg-surface p-6 sm:p-8 card-shadow-lg">
              <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand/10 blur-3xl" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                Setup progress
              </p>
              <div className="relative mt-8 space-y-0">
                {["Shopify connected", "India Post configured", "Automation rules ready"].map(
                  (label, i) => (
                    <div key={label} className="relative flex gap-4 pb-8 last:pb-0">
                      {i < 2 ? (
                        <span className="absolute left-[15px] top-8 h-[calc(100%-16px)] w-px bg-brand/30" />
                      ) : null}
                      <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                        {i + 1}
                      </span>
                      <div className="rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium text-ink">
                        {label}
                      </div>
                    </div>
                  )
                )}
              </div>
              <div className="mt-4 rounded-2xl border border-brand/20 bg-brand/5 px-4 py-3 text-sm font-medium text-brand">
                Ready to process your first shipment
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
