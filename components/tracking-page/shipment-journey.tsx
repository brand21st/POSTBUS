import { Check, CircleDot, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTrackDate, formatTrackTime } from "@/modules/tracking-pages/customer-track-view";
import type { CustomerTrackEvent } from "@/modules/tracking-pages/customer-track-view";

export function ShipmentJourney({ events }: { events: CustomerTrackEvent[] }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="shipment-journey-heading">
      <h2 id="shipment-journey-heading" className="text-lg font-semibold tracking-tight text-ink">
        Shipment Journey
      </h2>
      {events.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Scan events will appear here once India Post updates this shipment.</p>
      ) : (
        <ol className="relative mt-5 space-y-0">
          {events.map((event, index) => (
            <li key={`${event.status}-${event.timestamp}-${index}`} className="relative flex gap-3 pb-6 last:pb-0">
              {index < events.length - 1 ? (
                <span className="absolute left-[11px] top-7 bottom-0 w-px bg-border" aria-hidden="true" />
              ) : null}
              <span
                className={cn(
                  "relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
                  event.latest
                    ? "border-brand bg-brand text-white"
                    : "border-border bg-surface-soft text-muted"
                )}
                aria-label={event.latest ? `${event.title}, latest update` : event.title}
              >
                {event.latest ? (
                  <CircleDot className="size-3.5" aria-hidden="true" />
                ) : (
                  <Check className="size-3.5" aria-hidden="true" />
                )}
              </span>
              <div className={cn("min-w-0 flex-1", event.latest ? "text-ink" : "text-foreground/80")}>
                <p className={cn("font-semibold", event.latest ? "text-base" : "text-sm")}>{event.title}</p>
                {event.location ? (
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
                    <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                    {event.location}
                  </p>
                ) : null}
                {event.timestamp ? (
                  <p className="mt-0.5 text-xs text-muted">
                    {formatTrackDate(event.timestamp)}
                    {formatTrackTime(event.timestamp) ? ` · ${formatTrackTime(event.timestamp)}` : ""}
                  </p>
                ) : null}
                <p className={cn("mt-1 text-sm", event.latest ? "text-foreground" : "text-muted")}>
                  {event.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
