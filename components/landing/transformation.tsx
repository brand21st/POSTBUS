import { ArrowDown } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const withoutSteps = [
  "Shopify",
  "Download Order",
  "Copy Customer Details",
  "Shipping Portal",
  "Barcode",
  "Label",
  "Manifest",
  "Tracking",
  "WhatsApp Customer",
  "Manual Follow-up",
] as const;

const withSteps = [
  "SHOPIFY",
  "POSTBUS",
  "INDIA POST",
  "VACHAT",
  "WHATSAPP",
] as const;

export function Transformation() {
  return (
    <section className="bg-surface py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          title={
            <>
              From order to customer,
              <br />
              one connected workflow.
            </>
          }
        />
        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          <article className="rounded-[28px] border border-border bg-zinc-100/80 p-6 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
              Without PostBus
            </p>
            <div className="mt-6 space-y-2">
              {withoutSteps.map((step, index) => (
                <div key={step} className="flex flex-col items-start">
                  <span className="rounded-xl border border-zinc-300/80 bg-white px-3 py-2 text-sm font-medium text-zinc-600">
                    {step}
                  </span>
                  {index < withoutSteps.length - 1 ? (
                    <ArrowDown className="my-1 ml-3 size-3.5 text-zinc-400" />
                  ) : null}
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[28px] border border-brand/20 bg-white p-6 card-shadow-lg sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">
              With PostBus
            </p>
            <div className="mt-6 space-y-2">
              {withSteps.map((step, index) => (
                <div key={step} className="flex flex-col items-start">
                  <span
                    className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${
                      step === "POSTBUS" || step === "VACHAT"
                        ? "bg-brand text-white"
                        : "border border-border bg-surface text-ink"
                    }`}
                  >
                    {step}
                  </span>
                  {index < withSteps.length - 1 ? (
                    <ArrowDown className="my-1.5 ml-3 size-4 text-brand" />
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        </div>
      </Container>
    </section>
  );
}
