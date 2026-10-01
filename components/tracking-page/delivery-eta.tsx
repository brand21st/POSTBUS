import { formatTrackDate } from "@/modules/tracking-pages/customer-track-view";

export function DeliveryEta({ expectedDeliveryAt }: { expectedDeliveryAt: string | null }) {
  const date = formatTrackDate(expectedDeliveryAt);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="expected-delivery-heading">
      <h2 id="expected-delivery-heading" className="text-sm font-semibold text-ink">
        Expected Delivery
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        {date ? `Expected by ${date}` : "Delivery date will be updated when available."}
      </p>
    </section>
  );
}
