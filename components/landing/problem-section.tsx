import { AlertTriangle, ClipboardCopy, Layers3, MessageCircleWarning } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const problems = [
  {
    icon: ClipboardCopy,
    title: "Manual Order Processing",
    description:
      "Copying shipment details from store to carrier systems wastes time.",
  },
  {
    icon: Layers3,
    title: "Multiple Shipping Steps",
    description:
      "Booking, barcodes, labels and manifests create unnecessary operational work.",
  },
  {
    icon: MessageCircleWarning,
    title: "Tracking Follow-ups",
    description:
      "Customers want updates. Your team shouldn't have to check shipments manually.",
  },
  {
    icon: AlertTriangle,
    title: "Operational Errors",
    description:
      "Manual data entry creates avoidable mistakes in addresses, weight and shipment information.",
  },
] as const;

export function ProblemSection() {
  return (
    <section className="bg-white py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          title="Shipping shouldn't be your bottleneck."
          description="Growing Shopify stores often spend hours moving between orders, shipping portals, labels, manifests and tracking systems."
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {problems.map((item) => (
            <article
              key={item.title}
              className="rounded-[24px] border border-border bg-white p-6 transition-all duration-200 hover:-translate-y-1 hover:border-brand/20 card-shadow"
            >
              <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <item.icon className="size-5" />
              </div>
              <h3 className="text-lg font-semibold tracking-tight text-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.description}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
