import { Check } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const configRows = [
  { label: "Service", value: "Speed Post" },
  { label: "Pickup Location", value: "Connected" },
  { label: "Booking Status", value: "Ready" },
  { label: "Barcode", value: "Available" },
  { label: "Manifest", value: "Ready" },
] as const;

export function IndiaPostSection() {
  return (
    <section id="india-post" className="bg-surface py-20 sm:py-24 lg:py-28">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="order-2 lg:order-1">
            <div className="rounded-[28px] border border-border bg-white p-6 card-shadow-lg sm:p-8">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                    Shipping Configuration
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-ink">India Post workflow</h3>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  <Check className="size-3.5" />
                  Active
                </span>
              </div>
              <div className="space-y-3">
                {configRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3.5"
                  >
                    <span className="text-sm text-muted">{row.label}</span>
                    <span className="text-sm font-semibold text-ink">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <SectionHeading
              align="left"
              eyebrow="India Post"
              title="Built around your India Post shipping workflow."
              description="Manage shipment booking, barcode workflows, labels, manifests and tracking through one streamlined system."
            />
          </div>
        </div>
      </Container>
    </section>
  );
}
