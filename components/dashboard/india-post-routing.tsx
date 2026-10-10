import { Check, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IndiaPostRoutingView } from "@/lib/dashboard/india-post-routing";

function StageIcon({ completed, current }: { completed: boolean; current: boolean }) {
  if (completed) {
    return (
      <span className="flex size-8 items-center justify-center rounded-full bg-emerald-600 text-white">
        <Check className="size-4" aria-hidden="true" />
      </span>
    );
  }
  if (current) {
    return (
      <span className="flex size-8 items-center justify-center rounded-full border-2 border-emerald-600 bg-emerald-50 text-emerald-700">
        <Check className="size-4" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="flex size-8 items-center justify-center rounded-full border-2 border-red-500 bg-white text-red-500">
      <Check className="size-4 opacity-40" aria-hidden="true" />
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-ink">{value}</p>
    </div>
  );
}

export function IndiaPostRouting({ view }: { view: IndiaPostRoutingView }) {
  const origin = [view.bookedOffice, view.originPincode].filter(Boolean).join(" - ");
  const destination = [view.destinationOffice, view.destinationPincode].filter(Boolean).join(" - ");
  const delivered = view.progressPercent >= 100;
  const truckLeft = `${Math.min(100, Math.max(0, view.progressPercent))}%`;

  return (
    <div className="space-y-6">
      <ol className="flex items-start justify-between gap-1" aria-label="Delivery stages">
        {view.stages.map((stage, index) => (
          <li key={stage.stage} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
            {index < view.stages.length - 1 ? (
              <span
                className={cn(
                  "absolute left-[calc(50%+18px)] top-4 h-0.5 w-[calc(100%-36px)]",
                  stage.completed || stage.current ? "bg-emerald-600" : "bg-red-400"
                )}
                aria-hidden="true"
              />
            ) : null}
            <StageIcon completed={stage.completed} current={stage.current} />
            <p
              className={cn(
                "mt-2 text-xs font-medium",
                stage.completed || stage.current ? "text-emerald-700" : "text-red-600"
              )}
            >
              {stage.label}
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-8 px-1">
        <div className="relative h-10">
          <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-red-400" aria-hidden="true" />
          <div
            className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 bg-emerald-600"
            style={{ width: truckLeft }}
            aria-hidden="true"
          />
          <div className="absolute left-0 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-emerald-600 bg-white text-emerald-700">
            <span className="size-2 rounded-full bg-emerald-600" aria-hidden="true" />
          </div>
          <div
            className="absolute top-1/2 z-10 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-emerald-600 bg-white text-emerald-700"
            style={{ left: truckLeft }}
          >
            <Truck className="size-4" aria-hidden="true" />
          </div>
          <div
            className={cn(
              "absolute right-0 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border bg-white",
              delivered ? "border-emerald-600" : "border-red-500"
            )}
          >
            <span className={cn("size-2 rounded-full", delivered ? "bg-emerald-600" : "bg-red-500")} aria-hidden="true" />
          </div>
        </div>
        <div className="mt-3 flex items-start justify-between gap-3 text-xs text-muted">
          <p className="max-w-[40%]">
            {origin ? (
              <>
                Booked at
                <br />
                <span className="font-medium text-ink">{origin}</span>
              </>
            ) : (
              "Origin"
            )}
          </p>
          <p className="text-center font-semibold text-ink">{view.currentEvent || "Awaiting scan"}</p>
          <p className="max-w-[40%] text-right">
            Destination
            <br />
            <span className="font-medium text-ink">{destination || "—"}</span>
          </p>
        </div>
      </div>

      <div className="grid gap-4 rounded-xl border border-border bg-surface-soft/60 p-4 sm:grid-cols-3">
        <Detail label="Article Number:" value={view.articleNumber} />
        <div className="min-w-0 sm:col-span-2">
          <p className="text-xs text-muted">Article Type:</p>
          <span className="mt-1 inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-800">
            {view.articleType}
          </span>
        </div>
        <Detail label="Booked At:" value={view.bookedOffice ?? "—"} />
        <Detail label="Booked On:" value={view.bookedOn ?? "—"} />
        <Detail label="Destination:" value={view.destinationOffice ?? "—"} />
        {view.originPincode ? <Detail label="Origin Pincode:" value={view.originPincode} /> : null}
        {view.destinationPincode ? <Detail label="Destination Pincode:" value={view.destinationPincode} /> : null}
      </div>

      <section aria-labelledby="routing-steps-heading">
        <h3 id="routing-steps-heading" className="text-base font-semibold text-red-600">
          Routing Steps
        </h3>
        {view.steps.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No India Post scans yet. Sync tracking to load routing steps.</p>
        ) : (
          <ol className="mt-4 space-y-0">
            {view.steps.map((step, index) => (
              <li key={step.id} className="grid grid-cols-[5.5rem_1.5rem_1fr] gap-x-3">
                <div className="py-1 text-right text-xs text-muted">
                  <p className="font-medium text-ink">{step.dateLabel}</p>
                  <p>{step.timeLabel}</p>
                </div>
                <div className="relative flex justify-center">
                  {index < view.steps.length - 1 ? (
                    <span className="absolute top-2 bottom-0 w-px bg-emerald-600" aria-hidden="true" />
                  ) : null}
                  <span className="relative z-10 mt-1 flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
                </div>
                <div className="pb-5">
                  <p className={cn("text-sm font-semibold", step.latest ? "text-ink" : "text-foreground")}>
                    {step.title}
                  </p>
                  {step.office ? <p className="text-xs text-muted">{step.office}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
