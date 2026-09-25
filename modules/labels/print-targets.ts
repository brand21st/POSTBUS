export type ShipmentPrintTarget = "both" | "barcode" | "packing";

export function paperSizeForLabelKind(kind?: string | null) {
  return String(kind || "INDIA_POST").toUpperCase() === "MERCHANT" ? "A4" : "A6";
}

export function shipmentPrintJobs(
  row: {
    indiaPostLabelId?: string | null;
    india_post_label_id?: string | null;
    packingLabelId?: string | null;
    packing_label_id?: string | null;
    kind?: string | null;
    id: string;
  },
  target: ShipmentPrintTarget
) {
  const barcodeId =
    row.indiaPostLabelId ?? row.india_post_label_id ?? ((row.kind ?? "INDIA_POST") !== "MERCHANT" ? row.id : null);
  const packingId =
    row.packingLabelId ?? row.packing_label_id ?? ((row.kind ?? "") === "MERCHANT" ? row.id : null);
  const jobs: Array<{ id: string; paperSize: "A6" | "A4"; kind: "barcode" | "packing" }> = [];
  if ((target === "both" || target === "barcode") && barcodeId) {
    jobs.push({ id: barcodeId, paperSize: "A6", kind: "barcode" });
  }
  if ((target === "both" || target === "packing") && packingId) {
    jobs.push({ id: packingId, paperSize: "A4", kind: "packing" });
  }
  return jobs;
}

export function shipmentPrintLabel(row: {
  indiaPostLabelId?: string | null;
  india_post_label_id?: string | null;
  packingLabelId?: string | null;
  packing_label_id?: string | null;
  kind?: string | null;
  id: string;
}) {
  const jobs = shipmentPrintJobs(row, "both");
  if (jobs.length === 2) return "Print both";
  if (jobs[0]?.kind === "packing") return "Print packing";
  return "Print barcode";
}
