"use client";

import { cn } from "@/lib/utils";

const pipeline = [
  { id: "shopify", label: "Shopify" },
  { id: "booking", label: "Booking" },
  { id: "label", label: "Label" },
  { id: "manifest", label: "Manifest" },
  { id: "tracking", label: "Tracking" },
] as const;

const orders = [
  {
    id: "PB10284",
    customer: "Rahul",
    weight: "1.2 kg",
    status: "Ready",
    tone: "ready" as const,
  },
  {
    id: "PB10285",
    customer: "Anjali",
    weight: "0.8 kg",
    status: "Booking",
    tone: "booking" as const,
  },
  {
    id: "PB10286",
    customer: "Arjun",
    weight: "2.4 kg",
    status: "Booked",
    tone: "booked" as const,
  },
] as const;

const automation = [
  "Shopify Sync",
  "Shipment Booking",
  "Label Generation",
  "Tracking Sync",
] as const;

export function HeroShippingMockup({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[28px] border border-border bg-white card-shadow-lg",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 sm:px-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            PostBus Shipping Automation
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">42 Orders Ready to Ship</p>
        </div>
        <span className="rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm">
          Ship Selected Orders
        </span>
      </div>

      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-2 overflow-x-auto">
          {pipeline.map((step, index) => {
            const active = index === 1;
            const done = index < 1;
            return (
              <div key={step.id} className="flex min-w-0 flex-1 items-center">
                <div className="flex min-w-0 flex-col items-center gap-1.5">
                  <span
                    className={cn(
                      "relative flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold",
                      done && "border-brand/30 bg-brand/10 text-brand",
                      active && "border-brand bg-brand text-white",
                      !done && !active && "border-border bg-white text-muted"
                    )}
                  >
                    {done ? (
                      <span aria-hidden className="text-[11px] leading-none">
                        ✓
                      </span>
                    ) : (
                      index + 1
                    )}
                    {active ? (
                      <span className="absolute inset-0 animate-pulse-soft rounded-full bg-brand/30" />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "truncate text-[10px] font-medium",
                      active ? "text-brand" : "text-muted"
                    )}
                  >
                    {step.label}
                  </span>
                </div>
                {index < pipeline.length - 1 ? (
                  <div className="mx-1 mb-4 h-px flex-1 bg-gradient-to-r from-border to-brand/40" />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-2.5 p-4 sm:p-5">
        {orders.map((order) => (
          <div
            key={order.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface/70 px-3.5 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">
                Order #{order.id}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted">
                Customer: {order.customer} · Weight: {order.weight}
              </p>
            </div>
            <StatusBadge tone={order.tone} label={order.status} />
          </div>
        ))}
      </div>

      <div className="border-t border-border bg-surface px-4 py-4 sm:px-5">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
          Automation
        </p>
        <div className="grid grid-cols-2 gap-2">
          {automation.map((item, i) => (
            <div
              key={item}
              className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-xs font-medium text-ink"
            >
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  i === 1 ? "bg-brand animate-pulse-soft" : "bg-emerald-500"
                )}
              />
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  tone,
  label,
}: {
  tone: "ready" | "booking" | "booked";
  label: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        tone === "ready" && "bg-emerald-50 text-emerald-700",
        tone === "booking" && "bg-brand/10 text-brand",
        tone === "booked" && "bg-zinc-100 text-zinc-700"
      )}
    >
      {label}
    </span>
  );
}
