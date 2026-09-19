import { formatDate } from "@/lib/format";
import type { PublicTrackingEvent } from "@/types/api";

export function TrackingTimeline({
  events,
  emptyLabel = "No scan events yet for this shipment.",
}: {
  events: PublicTrackingEvent[];
  emptyLabel?: string;
}) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }

  return (
    <ol className="space-y-4">
      {events.map((event, index) => (
        <li key={event.id ?? `${event.eventCode}-${event.occurredAt}-${index}`} className="border-l border-current/20 pl-4">
          <p className="text-sm font-medium">
            {event.eventDescription ?? event.eventCode ?? "Scan event"}
          </p>
          <p className="mt-0.5 text-xs opacity-70">
            {[event.officeName, formatDate(event.occurredAt, true)].filter(Boolean).join(" · ")}
          </p>
        </li>
      ))}
    </ol>
  );
}
