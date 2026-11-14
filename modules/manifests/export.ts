import { writeWorkbook } from "@/lib/xlsx/write";
import type { ManifestDetail, ManifestSender } from "@/modules/manifests/service";

export const MANIFEST_EXPORT_HEADERS = [
  "S.No",
  "Barcode",
  "Order",
  "Consignee",
  "City",
  "State",
  "Pincode",
  "Service",
  "Weight (g)",
  "Payment",
  "COD amount",
  "Tariff",
  "Receiver company",
  "Address line 1",
  "Address line 2",
  "Address line 3",
  "Mobile",
  "Email",
  "Length (cm)",
  "Breadth (cm)",
  "Height (cm)",
  "Sender city",
  "Sender state",
  "Sender PIN",
  "Sender mobile",
  "Office id",
] as const;

const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);

function cm(value: number | null) {
  return value != null && value > 0 ? value : "";
}

export function manifestExportRows(manifest: ManifestDetail, sender: Pick<ManifestSender, "city" | "state" | "pincode" | "phone">) {
  return manifest.lines.map((line, index) => [
    index + 1,
    line.barcode,
    line.orderNumber ?? "",
    line.consignee ?? "",
    line.city ?? "",
    line.state ?? "",
    line.pincode ?? "",
    line.serviceLabel,
    line.weightGrams,
    line.paymentMode ?? "",
    line.codAmount,
    line.tariffAmount ?? "",
    line.company ?? "",
    line.line1 ?? "",
    line.line2 ?? "",
    line.line3 ?? "",
    line.phone ?? "",
    line.email ?? "",
    cm(line.lengthCm),
    cm(line.widthCm),
    cm(line.heightCm),
    sender.city ?? "",
    sender.state ?? "",
    sender.pincode ?? "",
    sender.phone ?? "",
    manifest.officeId ?? "",
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

export function manifestCsv(manifest: ManifestDetail, sender: Pick<ManifestSender, "city" | "state" | "pincode" | "phone">) {
  const rows = [MANIFEST_EXPORT_HEADERS as readonly (string | number)[], ...manifestExportRows(manifest, sender)];
  // BOM so Excel opens Indic consignee names as UTF-8.
  return BOM + rows.map((row) => row.map(csvCell).join(",")).join(CRLF) + CRLF;
}

export async function manifestXlsx(manifest: ManifestDetail, sender: Pick<ManifestSender, "city" | "state" | "pincode" | "phone">) {
  const totals = manifest.totals;
  return writeWorkbook([
    {
      name: "Manifest",
      rows: [[...MANIFEST_EXPORT_HEADERS], ...manifestExportRows(manifest, sender)],
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
