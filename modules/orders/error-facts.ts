export type ErrorFactKind = "provider" | "order" | "payment" | "invoice" | "shipment" | "address" | "parcel";

export type ErrorFact = {
  kind: ErrorFactKind;
  message: string;
  /** Exact provider or system code, when one was recorded. */
  code?: string;
};

const PRIORITY: ErrorFactKind[] = ["provider", "order", "payment", "invoice", "shipment", "address", "parcel"];

const STATUS_LABEL: Record<ErrorFactKind, string> = {
  provider: "Booking failed",
  order: "Delivery exception",
  payment: "Payment error",
  invoice: "Invoice error",
  shipment: "Shipment failed",
  address: "Address error",
  parcel: "Parcel details missing",
};

export const ERROR_KIND_LABEL: Record<ErrorFactKind, string> = {
  provider: "India Post",
  order: "Delivery",
  payment: "Payment",
  invoice: "Invoice",
  shipment: "Shipment",
  address: "Address",
  parcel: "Parcel",
};

/** Kinds the orders list can read from the row itself. Invoice facts only come from the server. */
const ROW_KINDS = new Set<ErrorFactKind>(["provider", "order", "payment", "shipment", "address", "parcel"]);

type FactSource = {
  status?: string | null;
  paymentStatus?: string | null;
  payment_status?: string | null;
  parcelWeightMode?: string | null;
  parcel_weight_mode?: string | null;
  parcelWeightGrams?: number | null;
  parcel_weight_grams?: number | null;
  lineItems?: Array<{ quantity?: number | null; weight_grams?: number | null; weightGrams?: number | null }> | null;
  shipment?: {
    status?: string | null;
    last_error?: string | null;
    lastError?: string | null;
    last_error_code?: string | null;
    lastErrorCode?: string | null;
    length_cm?: number | null;
    lengthCm?: number | null;
    width_cm?: number | null;
    widthCm?: number | null;
    height_cm?: number | null;
    heightCm?: number | null;
    weight_grams?: number | null;
    weightGrams?: number | null;
  } | null;
  invoice?: {
    status?: string | null;
    error_message?: string | null;
    errorMessage?: string | null;
  } | null;
  shippingAddress?: {
    address_validation_status?: string | null;
    address_validation_errors?: Array<{ message?: string } | string> | null;
  } | null;
};

const ACCEPTED = new Set([
  "BOOKED",
  "LABEL_PENDING",
  "LABEL_READY",
  "MANIFEST_PENDING",
  "MANIFEST_READY",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function messages(errors: unknown) {
  if (!Array.isArray(errors)) return [];
  return errors
    .map((issue) => (typeof issue === "string" ? issue : text((issue as { message?: unknown } | null)?.message)))
    .map((message) => message.trim())
    .filter(Boolean);
}

export function collectErrorFacts(input: FactSource): ErrorFact[] {
  const shipment = input.shipment;
  const shipmentStatus = text(shipment?.status).toUpperCase();
  if (ACCEPTED.has(shipmentStatus)) return [];

  const facts: ErrorFact[] = [];
  const provider = text(shipment?.lastError ?? shipment?.last_error);
  const code = text(shipment?.lastErrorCode ?? shipment?.last_error_code);
  if (provider || code) {
    facts.push({
      kind: "provider",
      message: provider || `India Post returned ${code}.`,
      ...(code ? { code } : {}),
    });
  }

  const orderStatus = text(input.status).toUpperCase();
  if (orderStatus === "NDR" || orderStatus === "RTO" || orderStatus === "FAILED") {
    facts.push({ kind: "order", message: `Order status is ${orderStatus}.` });
  }

  const payment = text(input.paymentStatus ?? input.payment_status).toUpperCase();
  if (payment === "FAILED" || payment === "UNPAID") {
    facts.push({ kind: "payment", message: `Payment is ${payment}.` });
  }

  const invoiceError = text(input.invoice?.errorMessage ?? input.invoice?.error_message);
  const invoiceStatus = text(input.invoice?.status).toUpperCase();
  if (invoiceError || invoiceStatus === "FAILED") {
    facts.push({ kind: "invoice", message: invoiceError || "Invoice generation failed." });
  }

  if (shipmentStatus === "FAILED" && !provider) {
    facts.push({ kind: "shipment", message: "Shipment booking failed without a provider message." });
  }

  const address = input.shippingAddress;
  const addressStatus = text(address?.address_validation_status).toUpperCase();
  if (addressStatus === "INVALID" || addressStatus === "NEEDS_REVIEW" || addressStatus === "VALIDATION_UNAVAILABLE") {
    const stored = messages(address?.address_validation_errors);
    facts.push({
      kind: "address",
      message:
        stored.join(" ") ||
        (addressStatus === "VALIDATION_UNAVAILABLE"
          ? "India Post could not verify this address."
          : "The shipping address failed validation."),
    });
  }

  const length = Number(shipment?.lengthCm ?? shipment?.length_cm ?? 0);
  const width = Number(shipment?.widthCm ?? shipment?.width_cm ?? 0);
  const height = Number(shipment?.heightCm ?? shipment?.height_cm ?? 0);
  if (!(length > 0 && width > 0 && height > 0)) {
    facts.push({ kind: "parcel", message: "Parcel length, width, and height are missing.", code: "PARCEL_SIZE" });
  }
  const manual = text(input.parcelWeightMode ?? input.parcel_weight_mode).toLowerCase() === "manual";
  const declared = Number(input.parcelWeightGrams ?? input.parcel_weight_grams ?? shipment?.weightGrams ?? shipment?.weight_grams ?? 0);
  const lineWeight = (input.lineItems ?? []).some((item) => {
    const grams = Number(item.weightGrams ?? item.weight_grams);
    const quantity = Number(item.quantity) || 0;
    return grams > 0 && quantity > 0;
  });
  if (!(manual && declared > 0) && declared <= 0 && !lineWeight && Number(shipment?.weightGrams ?? shipment?.weight_grams ?? 0) <= 0) {
    facts.push({ kind: "parcel", message: "Parcel weight is missing.", code: "PARCEL_WEIGHT" });
  }

  return facts;
}

const UNKNOWN_CODES = new Set(["CEPT_UNKNOWN", "ETIMEDOUT", "HTTP_500", "HTTP_502", "HTTP_503", "HTTP_504"]);

export function isUnknownBookingError(input: {
  last_error?: string | null;
  lastError?: string | null;
  last_error_code?: string | null;
  lastErrorCode?: string | null;
  summary?: string | null;
}) {
  const code = text(input.last_error_code ?? input.lastErrorCode).toUpperCase();
  if (UNKNOWN_CODES.has(code)) return true;
  const blob = `${text(input.last_error ?? input.lastError)} ${text(input.summary)}`.toUpperCase();
  return blob.includes("CEPT_UNKNOWN") || blob.includes("OUTCOME IS UNKNOWN");
}

function statusLabel(top: ErrorFact, facts: ErrorFact[]) {
  if (top.kind !== "parcel") return STATUS_LABEL[top.kind];
  const codes = new Set(facts.filter((fact) => fact.kind === "parcel").map((fact) => fact.code));
  if (codes.has("PARCEL_SIZE") && codes.has("PARCEL_WEIGHT")) return "Parcel details missing";
  if (codes.has("PARCEL_WEIGHT")) return "Weight missing";
  return "Parcel size missing";
}

export function finalErrorFromFacts(facts: ErrorFact[]) {
  if (!facts.length) return null;
  const top = PRIORITY.map((kind) => facts.find((fact) => fact.kind === kind)).find(Boolean);
  if (!top) return null;
  const rest = facts.filter((fact) => fact !== top).map((fact) => fact.message);
  return {
    status: statusLabel(top, facts),
    summary: rest.length ? `${top.message} Also: ${rest.join(" ")}` : top.message,
    kind: top.kind,
  };
}

export type ServerErrorStatus = {
  status: string;
  summary: string;
  source?: "ai" | "rules";
  kind?: ErrorFactKind;
  facts?: ErrorFact[];
};

export type DisplayErrorStatus = {
  status: string;
  summary: string;
  source: "ai" | "rules";
  kind: ErrorFactKind;
  facts: ErrorFact[];
};

function sameFacts(left: ErrorFact[], right: ErrorFact[]) {
  const key = (facts: ErrorFact[]) =>
    facts.map((fact) => `${fact.kind}|${fact.code ?? ""}|${fact.message}`).sort().join("\n");
  return key(left) === key(right);
}

/**
 * The row is refreshed right after a parcel or address edit; the server status may be minutes old.
 * Row-readable kinds come from the row, so a saved parcel size clears its error at once.
 * The server's wording (possibly AI) is kept only while its facts still match.
 */
export function resolveDisplayError(order: FactSource, server?: ServerErrorStatus | null): DisplayErrorStatus | null {
  const shipmentStatus = text(order.shipment?.status).toUpperCase();
  if (ACCEPTED.has(shipmentStatus)) return null;
  const rowFacts = collectErrorFacts(order);
  const serverFacts = server?.facts ?? [];
  const facts = [...rowFacts, ...serverFacts.filter((fact) => !ROW_KINDS.has(fact.kind))];
  const rules = finalErrorFromFacts(facts);
  if (!rules) return null;
  if (server?.status && server.facts && sameFacts(serverFacts, facts)) {
    return { status: server.status, summary: server.summary, source: server.source ?? "rules", kind: rules.kind, facts };
  }
  return { status: rules.status, summary: rules.summary, source: "rules", kind: rules.kind, facts };
}

export type ErrorQuickAction = "force" | "parcel" | "review" | "open";

export function errorQuickAction(error: DisplayErrorStatus, unknownBooking: boolean): ErrorQuickAction {
  if (unknownBooking) return "force";
  switch (error.kind) {
    case "parcel":
      return "parcel";
    case "provider":
    case "shipment":
    case "address":
      return "review";
    default:
      return "open";
  }
}

/** Red for failures, amber for details the merchant can fill in. */
export function errorTone(kind: ErrorFactKind): "failure" | "action" {
  return kind === "address" || kind === "parcel" ? "action" : "failure";
}
