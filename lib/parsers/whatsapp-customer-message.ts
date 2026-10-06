import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { INDIAN_STATES } from "@/lib/indian-states";

export type WhatsAppCustomerFields = {
  name?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
};

export type WhatsAppCustomerParseResult = {
  fields: WhatsAppCustomerFields;
  sources: Partial<Record<keyof WhatsAppCustomerFields, string>>;
};

const LABEL_ALIASES: Record<string, keyof WhatsAppCustomerFields> = {
  name: "name",
  "customer name": "name",
  "cust name": "name",
  "full name": "name",
  phone: "phone",
  mobile: "phone",
  "mobile number": "phone",
  "phone number": "phone",
  contact: "phone",
  address: "line1",
  addr: "line1",
  "full address": "line1",
  area: "line2",
  locality: "line2",
  "area / locality": "line2",
  city: "city",
  town: "city",
  district: "city",
  state: "state",
  pin: "pincode",
  pinocde: "pincode",
  pincode: "pincode",
  "pin code": "pincode",
  "pin-code": "pincode",
  "postal code": "pincode",
};

const LABEL_LINE = /^[\s*•\-–]*([A-Za-z][A-Za-z /_-]{1,40})\s*[:\-–]\s*(.*)$/;

function normalizeLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchIndianState(value: string) {
  const compact = value.trim().toLowerCase();
  if (!compact) return null;
  const exact = INDIAN_STATES.find((state) => state.toLowerCase() === compact);
  if (exact) return exact;
  const starts = INDIAN_STATES.filter((state) => state.toLowerCase().startsWith(compact));
  if (starts.length === 1) return starts[0];
  return null;
}

function cleanValue(value: string) {
  return value.replace(/^[\s,;.|]+/, "").replace(/[\s,;.|]+$/, "").replace(/\s+/g, " ").trim();
}

function assignField(
  result: WhatsAppCustomerParseResult,
  key: keyof WhatsAppCustomerFields,
  raw: string,
  source: string
) {
  const value = cleanValue(raw);
  if (!value) return;

  if (key === "phone") {
    const digits = extractIndiaMobileDigits(value);
    if (!digits) return;
    result.fields.phone = digits;
    result.sources.phone = source;
    return;
  }

  if (key === "pincode") {
    const digits = value.replace(/\D/g, "");
    if (!/^\d{6}$/.test(digits)) return;
    result.fields.pincode = digits;
    result.sources.pincode = source;
    return;
  }

  if (key === "state") {
    const state = matchIndianState(value);
    if (!state) return;
    result.fields.state = state;
    result.sources.state = source;
    return;
  }

  if (key === "name" && value.length < 2) return;
  if ((key === "line1" || key === "city") && value.length < 2) return;

  result.fields[key] = value;
  result.sources[key] = source;
}

/**
 * Deterministic WhatsApp address parser. Later an AI parser can implement the same result shape.
 */
export function parseWhatsAppCustomerMessage(text: string): WhatsAppCustomerParseResult {
  const result: WhatsAppCustomerParseResult = { fields: {}, sources: {} };
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");

  let pending: keyof WhatsAppCustomerFields | null = null;
  let pendingSource = "";
  const pendingParts: string[] = [];

  function flushPending() {
    if (!pending || pendingParts.length === 0) {
      pending = null;
      pendingParts.length = 0;
      return;
    }
    assignField(result, pending, pendingParts.join("\n"), pendingSource);
    pending = null;
    pendingParts.length = 0;
  }

  for (const line of lines) {
    const match = line.match(LABEL_LINE);
    if (match) {
      const label = normalizeLabel(match[1] ?? "");
      const field = LABEL_ALIASES[label];
      if (field) {
        flushPending();
        pending = field;
        pendingSource = label;
        pendingParts.push(match[2] ?? "");
        continue;
      }
    }
    if (pending) {
      if (!line.trim()) {
        flushPending();
        continue;
      }
      pendingParts.push(line);
    }
  }
  flushPending();

  return result;
}

export function applyWhatsAppCustomerFields<T extends WhatsAppCustomerFields>(
  current: T,
  parsed: WhatsAppCustomerFields,
  options?: { overwrite?: boolean }
): T {
  const next = { ...current };
  (Object.keys(parsed) as Array<keyof WhatsAppCustomerFields>).forEach((key) => {
    const incoming = parsed[key];
    if (!incoming) return;
    const existing = String(current[key] ?? "").trim();
    if (existing && !options?.overwrite) return;
    (next as WhatsAppCustomerFields)[key] = incoming;
  });
  return next;
}
