import { ArrowDown } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const nodes = [
  { type: "WHEN", label: "New Shopify Order" },
  { type: "THEN", label: "Create Shipment" },
  { type: "THEN", label: "Allocate Barcode" },
  { type: "THEN", label: "Generate Label" },
  { type: "THEN", label: "Book Shipment" },
  { type: "THEN", label: "Sync Tracking" },
] as const;

export function AutomationSection() {
  return (
    <section id="automation" className="bg-surface py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          title={
            <>
              Stop clicking.
              <br />
              Start automating.
            </>
          }
          description="Turn repetitive shipping tasks into clear automation rules your team can trust."
        />

        <div className="mx-auto mt-14 max-w-2xl">
          <div className="relative flex flex-col items-stretch">
            {nodes.map((node, index) => (
              <Reveal key={`${node.type}-${node.label}`} delay={index * 0.05}>
                <div>
                  <div className="rounded-[22px] border border-border bg-white p-4 card-shadow sm:p-5">
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
        </div>
      </Container>
    </section>
  );
}
