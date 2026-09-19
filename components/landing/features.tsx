import {
  Activity,
  Barcode,
  Boxes,
  FileText,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  Zap,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const features = [
  {
    icon: ShoppingBag,
    title: "Shopify Order Sync",
    description: "Bring your Shopify orders into PostBus automatically.",
  },
  {
    icon: PackageCheck,
    title: "India Post Shipment Booking",
    description:
      "Prepare and process shipments through your connected India Post workflow.",
  },
  {
    icon: Boxes,
    title: "Bulk Shipping",
    description: "Process multiple orders instead of handling shipments one by one.",
  },
  {
    icon: Barcode,
    title: "Labels & Barcodes",
    description: "Generate shipping labels and manage barcode workflows from one place.",
  },
  {
    icon: FileText,
    title: "Manifest Management",
    description: "Create and manage manifests without jumping between systems.",
  },
  {
    icon: RefreshCw,
    title: "Tracking Automation",
    description: "Keep shipment tracking information organized and synchronized.",
  },
  {
    icon: Zap,
    title: "Automation Engine",
    description: "Turn repetitive shipping tasks into automated workflows.",
  },
  {
    icon: Activity,
    title: "Analytics",
    description:
      "Understand your shipping activity, shipment status and operational performance.",
  },
] as const;

export function Features() {
  return (
    <section id="features" className="bg-white py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          eyebrow="Capabilities"
          title="Everything between order and delivery."
          description="One place for orders, shipments, labels, manifests and tracking."
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <article
              key={feature.title}
              className={`rounded-[24px] border border-border bg-white p-6 transition-all duration-200 hover:-translate-y-1 hover:border-brand/20 card-shadow ${
                index === 0 || index === 7 ? "sm:col-span-2 lg:col-span-2" : ""
              }`}
            >
              <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-white">
                <feature.icon className="size-5" />
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-ink">{feature.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[15px]">
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
