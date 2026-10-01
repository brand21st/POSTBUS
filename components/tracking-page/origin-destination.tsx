import { ArrowRight } from "lucide-react";
import type { CustomerPlace } from "@/modules/tracking-pages/customer-track-view";

function Place({ label, place }: { label: string; place: CustomerPlace }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{place.city}</p>
      {place.state ? <p className="text-xs text-muted">{place.state}</p> : null}
    </div>
  );
}

export function OriginDestination({
  origin,
  destination,
}: {
  origin: CustomerPlace | null;
  destination: CustomerPlace | null;
}) {
  if (!origin || !destination) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" aria-label="Shipment route">
      <div className="flex items-center gap-4">
        <Place label="Origin" place={origin} />
        <div className="flex min-w-0 flex-1 items-center text-muted" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <ArrowRight className="mx-1 size-4 shrink-0" />
          <span className="h-px flex-1 bg-border" />
        </div>
        <Place label="Destination" place={destination} />
      </div>
    </section>
  );
}
