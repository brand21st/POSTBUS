import { IndiaPostLogo } from "@/components/brand/india-post-logo";
import { TrackStatusBadge } from "@/components/tracking-page/track-status-badge";
import { formatTrackDateTime } from "@/modules/tracking-pages/customer-track-view";
import type { CustomerTrackView } from "@/modules/tracking-pages/customer-track-view";

export function ShipmentSummaryCard({ view }: { view: CustomerTrackView }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="current-status-heading">
      <p id="current-status-heading" className="text-xs font-semibold uppercase tracking-wider text-muted">
        Current status
      </p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">{view.statusLabel}</h2>
            <TrackStatusBadge label={view.statusLabel} tone={view.statusTone} />
          </div>
          <p className="mt-1.5 text-sm text-muted">{view.statusSupport}</p>
        </div>
        <IndiaPostLogo className="h-8 max-w-[7rem]" />
      </div>
      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Carrier</dt>
          <dd className="mt-0.5 font-medium text-ink">India Post</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Article / Barcode Number</dt>
          <dd className="mt-0.5 font-medium text-ink">{view.articleNumber}</dd>
        </div>
        {view.serviceLabel ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Service</dt>
            <dd className="mt-0.5 font-medium text-ink">{view.serviceLabel}</dd>
          </div>
        ) : null}
        {formatTrackDateTime(view.lastUpdatedAt) ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Last updated</dt>
            <dd className="mt-0.5 font-medium text-ink">{formatTrackDateTime(view.lastUpdatedAt)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
