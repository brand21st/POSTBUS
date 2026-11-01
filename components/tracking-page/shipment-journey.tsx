import { Check, CircleDot, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTrackDateIndia, formatTrackTimeIndia } from "@/modules/tracking-pages/customer-track-view";
import type { CustomerTrackEvent } from "@/modules/tracking-pages/customer-track-view";

function groupEvents(events: CustomerTrackEvent[]) {
  const groups: { date: string; events: CustomerTrackEvent[] }[] = [];
  for (const event of events) {
    const date = formatTrackDateIndia(event.timestamp) ?? "Update";
    const current = groups.at(-1);
    if (!current || current.date !== date) groups.push({ date, events: [event] });
    else current.events.push(event);
  }
  return groups;
}

export function ShipmentJourney({
  events,
  notice,
}: {
  events: CustomerTrackEvent[];
  notice?: string | null;
}) {
  const groups = groupEvents(events);
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="shipment-journey-heading">
      <h2 id="shipment-journey-heading" className="text-lg font-semibold tracking-tight text-ink">
        Shipment Journey
      </h2>
      {notice ? <p className="mt-4 text-sm text-muted">{notice}</p> : null}
      {events.length === 0 && !notice ? (
        <p className="mt-4 text-sm text-muted">Tracking updates are not available yet. Please check again later.</p>
      ) : null}
      {events.length > 0 ? (
        <div className="mt-5 space-y-5">
          {groups.map((group) => (
            <div key={group.date}>
              <p className="text-sm font-semibold text-ink">{group.date}</p>
              <ol className="relative mt-3 space-y-0">
                {group.events.map((event, index) => (
                  <li key={`${event.status}-${event.timestamp}-${index}`} className="relative flex gap-3 pb-6 last:pb-0">
                    {index < group.events.length - 1 ? (
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
                      {event.timestamp ? (
                        <p className="text-xs font-medium text-muted">{formatTrackTimeIndia(event.timestamp)}</p>
                      ) : null}
                      <p className={cn("font-semibold", event.latest ? "text-base" : "text-sm")}>{event.title}</p>
                      {event.originalEvent ? (
                        <p className="mt-0.5 text-sm text-muted">India Post Event: {event.originalEvent}</p>
                      ) : null}
                      {event.location ? (
                        <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
                          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                          {event.location}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
