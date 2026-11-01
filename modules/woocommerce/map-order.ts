import { normalizeIndiaMobile } from "@/lib/phone/india-whatsapp";
import { mapWooPayment } from "@/modules/woocommerce/payment";
import {
  clampWooParcelCm,
  normalizeWooLengthToCm,
  normalizeWooWeightToGrams,
  WOO_PARCEL_CM,
} from "@/modules/woocommerce/units";
import type { OrderStatus } from "@/types/domain";

export type WooRemoteAddress = {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
};

export type WooRemoteLine = {
  id?: number;
  name?: string;
  product_id?: number;
  variation_id?: number;
  quantity?: number;
  sku?: string;
  price?: string | number;
  subtotal?: string | number;
  total?: string | number;
  meta_data?: Array<{ key?: string; display_key?: string; value?: unknown }>;
};

export type WooRemoteOrder = {
  id?: number | string;
  number?: string;
  status?: string;
  currency?: string;
  date_created?: string;
  date_modified?: string;
  date_paid?: string | null;
  payment_method?: string;
  payment_method_title?: string;
  customer_note?: string;
  billing?: WooRemoteAddress;
  shipping?: WooRemoteAddress;
  line_items?: WooRemoteLine[];
  discount_total?: string | number;
  shipping_total?: string | number;
  total_tax?: string | number;
  total?: string | number;
  refunds?: Array<{ total?: string | number }>;
  meta_data?: Array<{ key?: string; value?: unknown }>;
};

export type WooProductMeasure = {
  weight?: string | number | null;
  dimensions?: { length?: string | number; width?: string | number; height?: string | number };
};

const TERMINAL = new Set(["cancelled", "refunded", "failed", "trash"]);
const DEFAULT_ELIGIBLE = ["processing", "on-hold"];

function text(value: unknown) {
  return String(value ?? "").trim();
}

function personName(address?: WooRemoteAddress, fallback?: string) {
  const name = [address?.first_name, address?.last_name].filter(Boolean).join(" ").trim();
  return name || text(address?.company) || fallback || "WooCommerce customer";
}

function addressOf(address: WooRemoteAddress | undefined, fallbackName: string) {
  return {
    name: personName(address, fallbackName),
    phone: normalizeIndiaMobile(address?.phone),
    line1: text(address?.address_1) || "Address not provided",
    line2: text(address?.address_2) || null,
    city: text(address?.city) || "Unknown",
    state: text(address?.state) || "Unknown",
    pincode: text(address?.postcode),
    country: text(address?.country) || "IN",
  };
}

export function wooRefundAmount(refunds?: Array<{ total?: string | number }>) {
  return (refunds ?? []).reduce((sum, row) => sum + Math.abs(Number(row.total) || 0), 0);
}

function nonemptyMeasure(value: unknown) {
  if (value == null) return false;
  const text = String(value).trim();
  if (!text) return false;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount > 0 : true;
}

function completeWooDimensions(dimensions?: WooProductMeasure["dimensions"] | null) {
  return (
    nonemptyMeasure(dimensions?.length) &&
    nonemptyMeasure(dimensions?.width) &&
    nonemptyMeasure(dimensions?.height)
  );
}

/** Variation shipping first; empty variation fields fall back to the parent product. */
export function mergeWooMeasures(
  primary?: WooProductMeasure | null,
  fallback?: WooProductMeasure | null
): WooProductMeasure {
  const weight = nonemptyMeasure(primary?.weight) ? primary?.weight : fallback?.weight;
  const dimensions = completeWooDimensions(primary?.dimensions)
    ? primary?.dimensions
    : fallback?.dimensions;
  return { weight: weight ?? undefined, dimensions };
}

export function wooParcelFromLines(
  lines: Array<{
    quantity: number;
    weightGrams: number | null;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
  }>
) {
  let weightGrams = 0;
  let maxL = 0;
  let maxW = 0;
  let maxH = 0;
  let hasBox = false;
  for (const line of lines) {
    const quantity = Math.max(1, Number(line.quantity) || 1);
    if (line.weightGrams && line.weightGrams > 0) weightGrams += line.weightGrams * quantity;
    if (line.lengthCm && line.widthCm && line.heightCm) {
      hasBox = true;
      maxL = Math.max(maxL, line.lengthCm);
      maxW = Math.max(maxW, line.widthCm);
      maxH = Math.max(maxH, line.heightCm);
    }
  }
  return {
    weightGrams: weightGrams > 0 ? Math.round(weightGrams) : null,
    lengthCm: hasBox ? clampWooParcelCm(maxL, WOO_PARCEL_CM.length.min, WOO_PARCEL_CM.length.max) : null,
    widthCm: hasBox ? clampWooParcelCm(maxW, WOO_PARCEL_CM.width.min, WOO_PARCEL_CM.width.max) : null,
    heightCm: hasBox ? clampWooParcelCm(maxH, WOO_PARCEL_CM.height.min, WOO_PARCEL_CM.height.max) : null,
  };
}

export function variationLabel(line: WooRemoteLine) {
  const attrs = (line.meta_data ?? [])
    .filter((row) => row.key && !String(row.key).startsWith("_"))
    .map((row) => text(row.value))
    .filter(Boolean);
  const name = text(line.name) || "Item";
  if (!attrs.length) return name;
  return `${name} (${attrs.join(", ")})`;
}

export function mapWooOrder(
  remote: WooRemoteOrder,
  input?: {
    eligibleStatuses?: string[] | null;
    weightUnit?: string | null;
    dimensionUnit?: string | null;
    measures?: Map<string, WooProductMeasure>;
  }
) {
  const sourceOrderId = text(remote.id);
  const wooStatus = text(remote.status).toLowerCase() || "pending";
  const eligibleList = (input?.eligibleStatuses ?? DEFAULT_ELIGIBLE).map((status) => status.toLowerCase());
  const terminal = TERMINAL.has(wooStatus);
  const eligible = eligibleList.includes(wooStatus);
  const billing = remote.billing ?? {};
  const shippingSource = remote.shipping?.address_1 ? remote.shipping : billing;
  const customerName = personName(shippingSource, personName(billing));
  const phone =
    normalizeIndiaMobile(shippingSource.phone) ||
    normalizeIndiaMobile(billing.phone) ||
    null;
  const shipping = addressOf(shippingSource, customerName);
  const billingAddress = addressOf(billing, customerName);
  const pincodeInvalid = !/^[1-9][0-9]{5}$/.test(shipping.pincode);
  const issues: string[] = [];
  if (!phone) issues.push("Missing customer phone");
  if (pincodeInvalid) issues.push("Invalid shipping pincode");

  const lines = (remote.line_items ?? []).map((line) => {
    const productId = Number(line.product_id) || 0;
    const variationId = Number(line.variation_id) || 0;
    const measure = input?.measures?.get(`${productId}:${variationId}`);
    const weightGrams = measure
      ? normalizeWooWeightToGrams(measure.weight, input?.weightUnit)
      : null;
    if (measure && !weightGrams) issues.push("Missing product weight");
    const quantity = Math.max(1, Number(line.quantity) || 1);
    const lineTotal = Number(line.total ?? line.subtotal ?? 0);
    const unitPrice = quantity > 0 ? Math.round((lineTotal / quantity) * 100) / 100 : 0;
    return {
      title: variationLabel(line),
      sku: text(line.sku) || null,
      quantity,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      weightGrams,
      wooProductId: productId || null,
      wooVariationId: variationId || null,
      lengthCm: measure ? normalizeWooLengthToCm(measure.dimensions?.length, input?.dimensionUnit) : null,
      widthCm: measure ? normalizeWooLengthToCm(measure.dimensions?.width, input?.dimensionUnit) : null,
      heightCm: measure ? normalizeWooLengthToCm(measure.dimensions?.height, input?.dimensionUnit) : null,
    };
  });

  const payment = mapWooPayment({
    paymentMethod: remote.payment_method,
    paymentMethodTitle: remote.payment_method_title,
    total: remote.total,
    refundTotal: wooRefundAmount(remote.refunds),
    datePaid: remote.date_paid,
    status: wooStatus,
  });

  let status: OrderStatus = "IMPORTED";
  if (terminal) status = "CANCELLED";
  else if (wooStatus === "processing" || wooStatus === "completed" || wooStatus === "on-hold") status = "READY";

  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return {
    sourceOrderId,
    orderNumber: text(remote.number) || sourceOrderId,
    wooStatus,
    status,
    terminal,
    eligible,
    customer: {
      name: customerName,
      phone,
      email: text(billing.email) || null,
    },
    shipping,
    billing: billingAddress,
    lines,
    subtotal,
    discount: Number(remote.discount_total) || 0,
    shippingAmount: Number(remote.shipping_total) || 0,
    taxAmount: Number(remote.total_tax) || 0,
    total: Number(remote.total) || 0,
    currency: text(remote.currency) || "INR",
    payment,
    issues: [...new Set(issues)],
    metadata: {
      woocommerce: {
        status: wooStatus,
        paymentMethod: text(remote.payment_method),
        currency: text(remote.currency) || "INR",
        total: text(remote.total),
        dateCreated: remote.date_created ?? null,
        dateModified: remote.date_modified ?? null,
        customerNote: text(remote.customer_note).slice(0, 500),
        issues: [...new Set(issues)],
      },
    },
  };
}

export type MappedWooOrder = ReturnType<typeof mapWooOrder>;
