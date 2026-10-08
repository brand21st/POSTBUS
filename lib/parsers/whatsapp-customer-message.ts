import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { INDIAN_STATES } from "@/lib/indian-states";

export type WhatsAppCustomerFields = {
  name?: string;
  phone?: string;
  email?: string;
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
  mob: "phone",
  "phone no": "phone",
  "phone no.": "phone",
  customer: "name",
  email: "email",
  "e-mail": "email",
  "email id": "email",
  "email address": "email",
  mail: "email",
  address: "line1",
  addr: "line1",
  "full address": "line1",
  area: "line2",
  locality: "line2",
  "area / locality": "line2",
  landmark: "line2",
  remarks: "line2",
  note: "line2",
  notes: "line2",
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

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function extractEmail(value: string) {
  const match = value.match(EMAIL_RE);
  return match ? match[0].toLowerCase() : null;
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

  if (key === "email") {
    const email = extractEmail(value);
    if (!email) return;
    result.fields.email = email;
    result.sources.email = source;
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

const FIELD_KEYS: Array<keyof WhatsAppCustomerFields> = [
  "name",
  "phone",
  "email",
  "line1",
  "line2",
  "city",
  "state",
  "pincode",
];

/** Drop invented or invalid AI values using the same rules as the label parser. */
export function fieldsFromUnknown(raw: unknown, source = "ai"): WhatsAppCustomerParseResult {
  const result: WhatsAppCustomerParseResult = { fields: {}, sources: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  const row = raw as Record<string, unknown>;
  for (const key of FIELD_KEYS) {
    const value =
      key === "line1" && !(typeof row.line1 === "string" && row.line1.trim())
        ? row.address
        : row[key];
    if (typeof value === "string" || typeof value === "number") {
      assignField(result, key, String(value), source);
    }
  }
  return result;
}

/**
 * Deterministic WhatsApp address parser. OpenRouter uses the same result shape.
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

  if (!result.fields.email) {
    const email = extractEmail(String(text ?? ""));
    if (email) assignField(result, "email", email, "email");
  }

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
