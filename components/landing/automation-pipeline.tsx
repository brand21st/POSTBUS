import { ArrowDown } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const steps = [
  "New Shopify Order",
  "Order Synced",
  "Shipment Created",
  "Barcode Allocated",
  "India Post Booking",
  "Label Generated",
  "Manifest",
  "Tracking",
  "Vachat Notification",
  "Customer",
] as const;

export function AutomationPipeline() {
  return (
    <section id="automation" className="bg-surface py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          title="Let the workflow run itself."
          description="From new order to customer WhatsApp update — one connected pipeline."
        />
        <div className="mx-auto mt-14 max-w-md">
          {steps.map((step, index) => (
            <Reveal key={step} delay={index * 0.03}>
              <div className="flex flex-col items-center">
                <div
                  className={`w-full rounded-2xl border px-4 py-3 text-center text-sm font-semibold ${
                    step === "Vachat Notification" || step === "Customer"
                      ? "border-brand/30 bg-brand text-white"
                      : "border-border bg-white text-ink card-shadow"
                  }`}
                >
                  {step}
                </div>
                {index < steps.length - 1 ? (
                  <ArrowDown className="my-2 size-4 text-brand" />
                ) : null}
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
