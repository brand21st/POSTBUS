export type InvoiceBadgeTone = "default" | "success" | "warning" | "error";

export type InvoiceOption = { value: string; label: string };

export const SALES_STATUS_OPTIONS: InvoiceOption[] = [
  { value: "DRAFT", label: "Draft" },
  { value: "REVIEW", label: "Needs review" },
  { value: "ISSUED", label: "Issued" },
  { value: "CANCELLED", label: "Cancelled" },
];

export const PAYMENT_OPTIONS: InvoiceOption[] = [
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIAL", label: "Partly paid" },
  { value: "PAID", label: "Paid" },
];

export const SOURCE_OPTIONS: InvoiceOption[] = [
  { value: "SHOPIFY", label: "Shopify" },
  { value: "WOOCOMMERCE", label: "WooCommerce" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "MANUAL", label: "Manual" },
  { value: "API", label: "API" },
];

export const DOCUMENT_TYPE_OPTIONS: InvoiceOption[] = [
  { value: "TAX_INVOICE", label: "Tax invoice" },
  { value: "BILL_OF_SUPPLY", label: "Bill of supply" },
  { value: "COMMERCIAL_INVOICE", label: "Commercial invoice" },
];

const SALES_STATUS_TONE: Record<string, InvoiceBadgeTone> = {
  DRAFT: "default",
  REVIEW: "warning",
  ISSUED: "success",
  CANCELLED: "error",
};

const PAYMENT_TONE: Record<string, InvoiceBadgeTone> = {
  UNPAID: "error",
  PARTIAL: "warning",
  PAID: "success",
};

const SHIPPING_STATUS: Record<string, { label: string; tone: InvoiceBadgeTone }> = {
  GENERATED: { label: "Ready", tone: "success" },
  PENDING: { label: "Generating", tone: "warning" },
  FAILED: { label: "Failed", tone: "error" },
};

function labelFrom(options: InvoiceOption[], value: string | null | undefined) {
  const key = (value ?? "").toUpperCase();
  return options.find((option) => option.value === key)?.label ?? (value || "—");
}

export function salesStatusBadge(status: string | null | undefined) {
  const key = (status ?? "").toUpperCase();
  return { label: labelFrom(SALES_STATUS_OPTIONS, status), tone: SALES_STATUS_TONE[key] ?? "default" };
}

export function paymentBadge(status: string | null | undefined) {
  const key = (status ?? "").toUpperCase();
  return { label: labelFrom(PAYMENT_OPTIONS, status), tone: PAYMENT_TONE[key] ?? "default" };
}

export function shippingStatusBadge(status: string | null | undefined) {
  const key = (status ?? "").toUpperCase();
  return SHIPPING_STATUS[key] ?? { label: labelFrom([], status), tone: "default" as const };
}

export function documentTypeLabel(type: string | null | undefined) {
  return labelFrom(DOCUMENT_TYPE_OPTIONS, type);
}

/** Only issued (or cancelled) invoices have a PDF; drafts must be issued first. */
export function salesInvoiceHasPdf(status: string | null | undefined) {
  const key = (status ?? "").toUpperCase();
  return key === "ISSUED" || key === "CANCELLED";
}

/** Total GST on a row, cess included, so rows add up to the summary card. */
export function rowGstPaise(row: { cgstPaise?: number; sgstPaise?: number; utgstPaise?: number; igstPaise?: number; cessPaise?: number }) {
  return (row.cgstPaise ?? 0) + (row.sgstPaise ?? 0) + (row.utgstPaise ?? 0) + (row.igstPaise ?? 0) + (row.cessPaise ?? 0);
}

/** Filename for a downloaded sales invoice PDF. Slashes in GST invoice numbers are not valid in filenames. */
export function salesInvoiceFilename(invoiceNumber: string | null | undefined, id: string) {
  const base = (invoiceNumber || `invoice-${id.slice(0, 8)}`).replace(/[\\/:*?"<>|]+/g, "-");
  return `${base}.pdf`;
}
