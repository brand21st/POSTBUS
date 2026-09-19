import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const floatingCards = [
  { label: "42 Orders Synced", style: { top: "8%", left: "-4%" } },
  { label: "18 Shipments Booked", style: { top: "22%", right: "-6%" } },
  { label: "12 Labels Generated", style: { bottom: "28%", left: "-8%" } },
  { label: "Tracking Updated", style: { bottom: "12%", right: "-2%" } },
  { label: "Automation Active", style: { top: "48%", right: "4%" } },
] as const;

export function AutomationShowcase() {
  return (
    <section className="relative overflow-hidden bg-ink py-20 sm:py-24 lg:py-28">
      <div className="pointer-events-none absolute inset-0 grid-fade opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-64 w-[600px] -translate-x-1/2 rounded-full bg-brand/20 blur-[100px]"
        aria-hidden
      />
      <Container className="relative">
        <SectionHeading
          light
          title={
            <>
              Your shipping operation,
              <br />
              on autopilot.
            </>
          }
          description="A clear view of orders ready to ship, bookings in progress, and automation running in the background."
        />

        <div className="relative mx-auto mt-16 max-w-4xl">
          {floatingCards.map((card) => (
            <div
              key={card.label}
              className="absolute z-20 hidden rounded-2xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-md lg:block"
              style={card.style}
            >
              <span className="mr-2 inline-block h-2 w-2 rounded-full bg-brand" />
              {card.label}
            </div>
          ))}

          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#121214] card-shadow-lg">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  PostBus Dashboard
                </p>
                <p className="mt-1 text-sm font-semibold text-white">Shipping overview</p>
              </div>
              <span className="rounded-full bg-brand/20 px-3 py-1 text-xs font-semibold text-brand">
                Live
              </span>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              {[
                { label: "Ready to ship", value: "42" },
                { label: "Booked today", value: "18" },
                { label: "In transit", value: "67" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <p className="text-xs text-zinc-500">{stat.label}</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
            <div className="space-y-2.5 px-5 pb-5">
              {[
                { order: "#PB10291", status: "Label ready", progress: "88%" },
                { order: "#PB10292", status: "Booking", progress: "54%" },
                { order: "#PB10293", status: "Synced", progress: "100%" },
              ].map((row) => (
                <div
                  key={row.order}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-white">{row.order}</p>
                    <p className="text-xs text-zinc-500">{row.status}</p>
                  </div>
                  <div className="w-28">
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: row.progress }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-3 lg:hidden">
            {floatingCards.map((card) => (
              <span
                key={card.label}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300"
              >
                {card.label}
              </span>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
