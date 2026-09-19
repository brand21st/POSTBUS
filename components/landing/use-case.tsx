import { Reveal } from "@/components/ui/reveal";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const early = [
  { time: "10:00", event: "Shopify order arrives" },
  { time: "10:01", event: "PostBus syncs order" },
  { time: "10:02", event: "Shipment is booked" },
  { time: "10:03", event: "Label generated" },
  { time: "10:04", event: "Vachat sends WhatsApp update" },
  { time: "10:05", event: "Customer receives tracking" },
] as const;

const later = [
  { label: "Out for Delivery", result: "Vachat Notification" },
  { label: "Delivered", result: "Vachat Confirmation" },
] as const;

export function UseCase() {
  return (
    <section className="bg-surface py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          eyebrow="Imagine this"
          title="From order to customer update — in minutes."
        />
        <div className="mx-auto mt-14 max-w-3xl">
          <div className="space-y-3">
            {early.map((item, index) => (
              <Reveal key={item.time} delay={index * 0.04}>
                <div className="flex items-center gap-4 rounded-2xl border border-border bg-white px-4 py-3.5 card-shadow sm:gap-6 sm:px-5">
                  <span className="w-14 shrink-0 font-mono text-sm font-bold text-brand">
                    {item.time}
                  </span>
                  <p className="text-sm font-medium text-ink sm:text-base">{item.event}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <p className="my-8 text-center text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Later…
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            {later.map((item) => (
              <div
                key={item.label}
                className="rounded-[24px] border border-brand/20 bg-white p-5 card-shadow"
              >
                <p className="text-lg font-semibold text-ink">{item.label}</p>
                <p className="mt-2 text-sm font-medium text-brand">↓ {item.result}</p>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
