import { writeWorkbook } from "@/lib/xlsx/write";
import type { ManifestDetail } from "@/modules/manifests/service";

export const MANIFEST_EXPORT_HEADERS = [
  "S.No",
  "Barcode",
  "Order",
  "Consignee",
  "City",
  "Pincode",
  "Service",
  "Weight (g)",
  "Payment",
  "COD amount",
  "Tariff",
] as const;

const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);

export function manifestExportRows(manifest: ManifestDetail) {
  return manifest.lines.map((line, index) => [
    index + 1,
    line.barcode,
    line.orderNumber ?? "",
    line.consignee ?? "",
    line.city ?? "",
    line.pincode ?? "",
    line.serviceLabel,
    line.weightGrams,
    line.paymentMode ?? "",
    line.codAmount,
    line.tariffAmount ?? "",
  ]);
}

export function manifestFileBase(manifest: Pick<ManifestDetail, "number" | "date" | "officeId">) {
  const base = manifest.number ?? `MF-DRAFT-${manifest.date.replace(/-/g, "")}-${manifest.officeId ?? "NA"}`;
  return base.replace(/[^A-Za-z0-9._-]/g, "_");
}

function csvCell(value: string | number) {
  const raw = String(value ?? "");
  // Neutralise spreadsheet formulas from consignee/order text.
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function manifestCsv(manifest: ManifestDetail) {
  const rows = [MANIFEST_EXPORT_HEADERS as readonly (string | number)[], ...manifestExportRows(manifest)];
  // BOM so Excel opens Indic consignee names as UTF-8.
  return BOM + rows.map((row) => row.map(csvCell).join(",")).join(CRLF) + CRLF;
}

export async function manifestXlsx(manifest: ManifestDetail) {
  const totals = manifest.totals;
  return writeWorkbook([
    {
      name: "Manifest",
      rows: [[...MANIFEST_EXPORT_HEADERS], ...manifestExportRows(manifest)],
    },
    {
      name: "Summary",
      rows: [
        ["Manifest", manifest.number ?? "Draft"],
        ["Date", manifest.date],
        ["Office", [manifest.officeName, manifest.officeId].filter(Boolean).join(" · ")],
        ["Status", manifest.status],
        ["Articles", totals.count],
        ["Total weight (g)", totals.weightGrams],
        ["COD articles", totals.codCount],
        ["COD amount", totals.codAmount],
        [],
        ["Service", "Articles", "Weight (g)"],
        ...totals.byService.map((service) => [service.label, service.count, service.weightGrams]),
      ],
    },
  ]);
}
