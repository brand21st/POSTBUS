export function pickOfficialPreviewLabel<
  T extends {
    kind?: string | null;
    status?: string | null;
    fileUrl?: string | null;
    file_url?: string | null;
    shipmentId?: string | null;
    shipment_id?: string | null;
  },
>(items: T[], shipmentId?: string | null) {
  const official = items.filter(
    (row) => (row.kind ?? "INDIA_POST") === "INDIA_POST" && (row.status ?? "").toUpperCase() === "READY"
  );
  const forShipment = shipmentId
    ? official.filter((row) => (row.shipmentId || row.shipment_id) === shipmentId)
    : official;
  const pool = forShipment.length ? forShipment : official;
  return pool.find((row) => Boolean(row.fileUrl || row.file_url)) ?? pool[0] ?? null;
}
