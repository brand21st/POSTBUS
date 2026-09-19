import type { TrackingPageRecord } from "@/types/api";

export function StoreLocationCard({ page }: { page: Pick<
  TrackingPageRecord,
  | "storeName"
  | "locationName"
  | "line1"
  | "line2"
  | "city"
  | "state"
  | "pincode"
  | "phone"
  | "email"
  | "whatsapp"
  | "mapUrl"
> }) {
  const lines = [
    page.locationName,
    page.line1,
    page.line2,
    [page.city, page.state, page.pincode].filter(Boolean).join(", "),
  ].filter(Boolean);

  if (lines.length === 0 && !page.phone && !page.email && !page.whatsapp) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Store location</h2>
      <p className="mt-2 text-base font-medium">{page.locationName || page.storeName}</p>
      <div className="mt-1 space-y-0.5 text-sm opacity-80">
        {page.line1 ? <p>{page.line1}</p> : null}
        {page.line2 ? <p>{page.line2}</p> : null}
        <p>{[page.city, page.state, page.pincode].filter(Boolean).join(", ")}</p>
        {page.phone ? <p>Phone: {page.phone}</p> : null}
        {page.email ? <p>Email: {page.email}</p> : null}
        {page.whatsapp ? <p>WhatsApp: {page.whatsapp}</p> : null}
      </div>
      {page.mapUrl ? (
        <a
          href={page.mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex text-sm font-semibold underline-offset-4 hover:underline"
        >
          Open map
        </a>
      ) : null}
    </section>
  );
}
