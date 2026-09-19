import { ArrowDown } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

export function VachatAi() {
  return (
    <section className="bg-surface py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          title={
            <>
              Not just notifications.
              <br />
              A WhatsApp AI assistant.
            </>
          }
          description="When customers ask about their order, Vachat uses live PostBus order and shipping information — rather than guessing."
        />

        <div className="mx-auto mt-14 grid max-w-5xl gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="rounded-[28px] border border-border bg-white p-6 card-shadow">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Customer asks
            </p>
            <p className="mt-4 rounded-2xl bg-surface px-4 py-3 text-base font-medium text-ink">
              “Where is my order?”
            </p>
            <div className="mt-6 space-y-2">
              {["Order Data", "Shipment Data", "Tracking Data"].map((item) => (
                <div
                  key={item}
                  className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium text-ink"
                >
                  PostBus · {item}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 text-brand">
            <ArrowDown className="size-5 lg:hidden" />
            <span className="hidden rounded-full bg-brand px-4 py-2 text-xs font-bold tracking-[0.14em] text-white lg:inline">
              VACHAT AI
            </span>
            <ArrowDown className="hidden size-5 lg:block" />
            <span className="rounded-full bg-brand px-4 py-2 text-xs font-bold tracking-[0.14em] text-white lg:hidden">
              VACHAT AI
            </span>
          </div>

          <div className="rounded-[28px] border border-border bg-white p-6 card-shadow">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              WhatsApp response
            </p>
            <div className="mt-4 rounded-2xl border border-border bg-surface px-4 py-4 text-sm leading-relaxed text-ink">
              <p>Your order #PB10284 is currently in transit.</p>
              <p className="mt-3">
                Tracking number:
                <br />
                <span className="font-mono font-semibold">XXXXXXXXXXXX</span>
              </p>
              <p className="mt-3 font-semibold text-brand">Track your shipment →</p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
