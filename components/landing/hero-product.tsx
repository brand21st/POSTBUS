"use client";

import { cn } from "@/lib/utils";

const orders = [
  {
    id: "PB10284",
    amount: "₹2,499",
    weight: "1.2 kg",
    status: "Ready to Ship",
    tone: "ready" as const,
  },
  {
    id: "PB10285",
    amount: "₹1,899",
    weight: "0.8 kg",
    status: "Processing",
    tone: "processing" as const,
  },
  {
    id: "PB10286",
    amount: "₹3,499",
    weight: "2.4 kg",
    status: "Booked",
    tone: "booked" as const,
  },
] as const;

const pipeline = ["Shopify", "Shipment Booking", "Label", "Manifest", "Tracking"] as const;

export function HeroProduct({ className }: { className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <div className="overflow-hidden rounded-[28px] border border-border bg-white card-shadow-lg">
        <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 sm:px-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              PostBus
            </p>
            <p className="mt-1 text-sm font-semibold text-ink">Shipping Automation</p>
          </div>
          <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand">
            Live
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div>
            <p className="text-lg font-semibold tracking-tight text-ink">
              42 Orders Ready to Ship
            </p>
          </div>
          <span className="shrink-0 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white">
            Ship Selected Orders
          </span>
        </div>

        <div className="space-y-2.5 p-4 sm:p-5">
          {orders.map((order) => (
            <div
              key={order.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface/80 px-3.5 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">#{order.id}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {order.amount} · {order.weight}
                </p>
              </div>
              <StatusBadge tone={order.tone} label={order.status} />
            </div>
          ))}
        </div>

        <div className="border-t border-border bg-surface px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted">
            {pipeline.map((step, index) => (
              <div key={step} className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1",
                    index === 1
                      ? "bg-brand text-white"
                      : index < 1
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-white text-muted border border-border"
                  )}
                >
                  {step}
                </span>
                {index < pipeline.length - 1 ? (
                  <span className="text-brand/50">↓</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="absolute -bottom-4 -right-2 z-20 w-[min(100%,220px)] sm:-right-6 sm:bottom-8 sm:w-[240px]">
        <div className="rounded-2xl border border-border bg-white p-4 card-shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand">
                Vachat
              </p>
              <p className="mt-0.5 text-sm font-semibold text-ink">WhatsApp AI</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />
              Connected
            </span>
          </div>
          <p className="mt-3 text-sm font-medium text-ink">Customer notified</p>
          <div className="mt-3 space-y-1 text-[11px] font-medium text-muted">
            <p className="text-ink">PostBus · Shipment Booked</p>
            <p>↓ Vachat</p>
            <p>↓ WhatsApp</p>
            <p className="text-brand">↓ Customer</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  tone,
  label,
}: {
  tone: "ready" | "processing" | "booked";
  label: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        tone === "ready" && "bg-emerald-50 text-emerald-700",
        tone === "processing" && "bg-brand/10 text-brand",
        tone === "booked" && "bg-zinc-100 text-zinc-700"
      )}
    >
      {label}
    </span>
  );
}
