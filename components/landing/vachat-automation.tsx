import { ArrowDown } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const nodes = [
  { type: "WHEN", label: "Shipment Booked" },
  { type: "THEN", label: "Vachat sends WhatsApp message" },
  { type: "WHEN", label: "Shipment becomes Out for Delivery" },
  { type: "THEN", label: "Vachat sends update" },
  { type: "WHEN", label: "Shipment Delivered" },
  { type: "THEN", label: "Vachat sends delivery confirmation" },
] as const;

export function VachatAutomation() {
  return (
    <section id="vachat-automation" className="bg-white py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          title="Automated customer communication."
          description="Turn shipping status changes into clear WhatsApp updates."
        />
        <div className="mx-auto mt-14 max-w-2xl">
          {nodes.map((node, index) => (
            <Reveal key={`${node.type}-${node.label}`} delay={index * 0.04}>
              <div>
                <div className="rounded-[22px] border border-border bg-surface p-4 card-shadow sm:p-5">
                  <div className="flex items-center gap-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] ${
                        node.type === "WHEN"
                          ? "bg-ink text-white"
                          : "bg-brand/10 text-brand"
                      }`}
                    >
                      {node.type}
                    </span>
                    <p className="text-base font-semibold text-ink">{node.label}</p>
                  </div>
                </div>
                {index < nodes.length - 1 ? (
                  <div className="flex justify-center py-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-brand/20 bg-brand/5 text-brand">
                      <ArrowDown className="size-4" />
                    </div>
                  </div>
                ) : null}
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
