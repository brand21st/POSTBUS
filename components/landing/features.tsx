import {
  Barcode,
  Boxes,
  FileText,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Zap,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const features = [
  {
    icon: ShoppingBag,
    title: "Stop copying every order by hand",
    description:
      "Bring Shopify orders into a shipping workspace, or add manual shipments when an order never lived in a store.",
  },
  {
    icon: PackageCheck,
    title: "Book India Post shipments without the portal grind",
    description:
      "Prepare Speed Post and other contracted services through your connected Customer ID workflow.",
  },
  {
    icon: Barcode,
    title: "Generate shipping labels in seconds",
    description:
      "Create India Post labels and manage barcode allocation from the same queue you use to book.",
  },
  {
    icon: ReceiptText,
    title: "Invoices that match the shipment",
    description: "Create professional invoices for orders without a separate billing spreadsheet.",
  },
  {
    icon: FileText,
    title: "Manifests without extra tools",
    description: "Organize pickup-ready manifests instead of rebuilding the same list in another system.",
  },
  {
    icon: RefreshCw,
    title: "Know where every shipment is",
    description:
      "Keep AWB tracking and delivery status next to the order, instead of checking India Post one AWB at a time.",
  },
  {
    icon: Boxes,
    title: "Process a day’s shipments together",
    description: "Move multiple orders through booking and labels instead of repeating the same clicks.",
  },
  {
    icon: Zap,
    title: "Automate the steps you repeat daily",
    description:
      "Turn repetitive booking, label and tracking tasks into rules your team can trust — including WhatsApp updates via Wati on eligible plans.",
  },
] as const;

export function Features() {
  return (
    <section id="features" className="bg-surface py-14 sm:py-20 lg:py-24">
      <Container>
        <SectionHeading
          eyebrow="What you get"
          title="Shipping work, minus the extra tabs."
          description="PostBus is the operations layer on top of India Post: orders in, labels out, tracking visible."
        />
        <div className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-[24px] border border-border bg-white p-5 sm:p-6"
            >
              <div className="mb-4 inline-flex size-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <feature.icon className="size-5" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold tracking-tight text-ink sm:text-lg">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{feature.description}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
