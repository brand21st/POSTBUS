import { formatTrackDateTime } from "@/modules/tracking-pages/customer-track-view";
import type { CustomerTrackView } from "@/modules/tracking-pages/customer-track-view";

export function ExceptionAlert({ exception }: { exception: NonNullable<CustomerTrackView["exception"]> }) {
  return (
    <section
      className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950"
      role="status"
      aria-labelledby="delivery-update-heading"
    >
      <h2 id="delivery-update-heading" className="text-sm font-semibold">
        Delivery Update
      </h2>
      <p className="mt-1 text-sm">Your shipment is taking longer than expected.</p>
      <p className="mt-3 text-sm">
        <span className="font-medium">{exception.latestTitle}</span>
        {exception.location ? ` · ${exception.location}` : ""}
      </p>
      {formatTrackDateTime(exception.timestamp) ? (
        <p className="mt-0.5 text-xs text-amber-900/80">{formatTrackDateTime(exception.timestamp)}</p>
      ) : null}
      {exception.explanation ? <p className="mt-2 text-sm">{exception.explanation}</p> : null}
    </section>
  );
}
