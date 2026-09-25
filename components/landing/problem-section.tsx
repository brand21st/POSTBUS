import { AlertTriangle, ClipboardCopy, Layers3, MessageCircleWarning } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const problems = [
  {
    icon: ClipboardCopy,
    title: "Copying orders into India Post",
    description:
      "Moving names, addresses and weights from your store or spreadsheet into the India Post portal wastes time on every shipment.",
  },
  {
    icon: Layers3,
    title: "Labels, barcodes and manifests",
    description:
      "Booking, printing labels and preparing manifests live in different steps. One missed click delays the whole pickup.",
  },
  {
    icon: MessageCircleWarning,
    title: "Tracking follow-ups",
    description:
      "Customers ask “where is my order?” Your team should not have to check India Post status by hand.",
  },
  {
    icon: AlertTriangle,
    title: "Avoidable booking errors",
    description:
      "Manual entry creates wrong pincodes, weights and service choices that hold up Speed Post bookings.",
  },
] as const;

export function ProblemSection() {
  return (
    <section id="problem" className="bg-white py-14 sm:py-20 lg:py-24">
      <Container>
        <SectionHeading
          eyebrow="The problem"
          title="India Post shipping should not be a second full-time job."
          description="If you already have an India Post Customer ID, the courier is not the bottleneck. The bottleneck is switching between orders, the booking portal, labels, manifests and tracking."
        />
        <div className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-4 sm:gap-5">
          {problems.map((item) => (
            <article
              key={item.title}
              className="rounded-[22px] border border-border bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] sm:p-6"
            >
              <div className="mb-4 inline-flex size-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <item.icon className="size-5" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold tracking-tight text-ink sm:text-lg">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.description}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
