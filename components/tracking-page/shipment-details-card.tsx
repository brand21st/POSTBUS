export function ShipmentDetailsCard({ details }: { details: { label: string; value: string }[] }) {
  if (details.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="shipment-details-heading">
      <h2 id="shipment-details-heading" className="text-lg font-semibold tracking-tight text-ink">
        Shipment Details
      </h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {details.map((row) => (
          <div key={row.label} className="min-w-0">
            <dt className="text-xs uppercase tracking-wide text-muted">{row.label}</dt>
            <dd className="mt-0.5 text-sm font-medium text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
