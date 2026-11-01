"use client";

import type { QueueSummary } from "@/modules/booking-queue/service";
import { QUEUE_KPI_CARDS, type QueueBucketFilter } from "@/components/booking-queue/view";
import { cn } from "@/lib/utils";

/** Same card pattern as OrderKpiStrip; counts come from booking-queue/summary. */
export function QueueKpiStrip({
  summary,
  loading,
  error,
  active,
  onSelect,
}: {
  summary?: QueueSummary;
  loading?: boolean;
  error?: boolean;
  active: QueueBucketFilter;
  onSelect: (bucket: QueueBucketFilter) => void;
}) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-8 [&::-webkit-scrollbar]:hidden">
      {QUEUE_KPI_CARDS.map((card) => {
        const value = card.bucket === "all" ? summary?.counts.total : summary?.counts[card.bucket];
        return (
          <button
            key={card.bucket}
            type="button"
            aria-pressed={active === card.bucket}
            onClick={() => onSelect(card.bucket)}
            className={cn(
              "min-w-[8.75rem] shrink-0 rounded-xl border px-2.5 py-2 text-left transition-colors hover:shadow-sm sm:min-w-0",
              card.className,
              active === card.bucket && "ring-2 ring-brand/30"
            )}
          >
            <p className="truncate text-[11px] font-medium text-muted">{card.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-ink">
              {loading ? "…" : error ? "—" : (value ?? 0).toLocaleString("en-IN")}
            </p>
          </button>
        );
      })}
    </div>
  );
}
