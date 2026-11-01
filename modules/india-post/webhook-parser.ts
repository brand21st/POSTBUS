/**
 * CEPT External Integrations Approach Document (updated 25.05.2026)
 * sample "event payload" field names only. Do not invent additional fields.
 */
export const CEPT_SAMPLE_WEBHOOK_PAYLOAD = {
  article_number: "AW784699994IN",
  article_type: "SP_INLAND_PARCEL",
  event_date: "2025-11-09",
  event_time: "08:37:52",
  event_office_facility_id: "21250003",
  event_office_name: "KADUGODI BNPL CENTRE",
  event_code: "BAG_CLOSE",
  event_description: "Bag Close",
  non_delivery_reason: "",
  booking_ref_id: 1026577399592963,
  booking_date: "2025-11-09",
  booking_time: "08:32:11",
  booking_office_facility_id: 21250003,
  booking_office_name: "KADUGODI BNPL CENTRE",
  booking_pin: 560067,
  sender_address_city: "BANGALORE",
  destination_office_facility_id: 23660808,
  destination_office_name: "Pandhana S.O",
  destination_pincode: 450661,
  destination_city: "East Nimar",
  destination_country: "INDIA",
  receiver_name: "Nilesh",
  invoice_no: "2125000309112526403",
  line_item: "",
  weight_value: 740,
  tariff: 106.2,
  cod_amount: 0,
  booking_type: "RBC",
  contract_number: 40000354,
  reference: "2125000309112526403",
  bulk_customer_id: 1000002954,
} as const;

const CEPT_FIELDS = [
  "article_number",
  "article_type",
  "event_date",
  "event_time",
  "event_office_facility_id",
  "event_office_name",
  "event_code",
  "event_description",
  "non_delivery_reason",
  "booking_ref_id",
  "booking_date",
  "booking_time",
  "booking_office_facility_id",
  "booking_office_name",
  "booking_pin",
  "sender_address_city",
  "destination_office_facility_id",
  "destination_office_name",
  "destination_pincode",
  "destination_city",
  "destination_country",
  "receiver_name",
  "invoice_no",
  "line_item",
  "weight_value",
  "tariff",
  "cod_amount",
  "booking_type",
  "contract_number",
  "reference",
  "bulk_customer_id",
] as const;

export type IndiaPostWebhookChannel = "booking" | "events";

export type ParsedIndiaPostWebhook = {
  provider: "INDIA_POST";
  channel: IndiaPostWebhookChannel;
  providerEventId: null;
  barcode: string | null;
  eventCode: string | null;
  eventDescription: string | null;
  eventTimestamp: string | null;
  officeId: string | null;
  officeName: string | null;
  customerId: string | null;
  contractId: string | null;
  nonDeliveryReason: string | null;
  parseError: string | null;
  rawPayload: Record<string, unknown>;
};

function asText(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

const EXPLICIT_OFFSET = /(?:[zZ]|[+-]\d{2}:\d{2})$/;

/**
 * CEPT's webhook sample sends event_date and event_time with no offset.
 * The source zone is not documented, so those values are not labeled UTC or IST.
 * An explicit offset is honored. A bare wall clock stays unparsed.
 */
export function indiaPostWebhookEventTimestamp(eventDate: string | null, eventTime: string | null) {
  if (!eventDate) return null;
  if (EXPLICIT_OFFSET.test(eventDate) && !eventTime) {
    const parsed = new Date(eventDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (eventTime && EXPLICIT_OFFSET.test(eventTime)) {
    const date = eventDate.slice(0, 10);
    const parsed = new Date(`${date}T${eventTime}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (EXPLICIT_OFFSET.test(eventDate)) {
    const parsed = new Date(eventDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

export function parseIndiaPostWebhook(
  rawBody: string,
  contentType: string | null,
  channel: IndiaPostWebhookChannel
): ParsedIndiaPostWebhook {
  const empty: ParsedIndiaPostWebhook = {
    provider: "INDIA_POST",
    channel,
    providerEventId: null,
    barcode: null,
    eventCode: null,
    eventDescription: null,
    eventTimestamp: null,
    officeId: null,
    officeName: null,
    customerId: null,
    contractId: null,
    nonDeliveryReason: null,
    parseError: null,
    rawPayload: {},
  };

  const trimmed = rawBody.trim();
  if (!trimmed) {
    return { ...empty, parseError: "Empty body." };
  }

  const type = (contentType || "").toLowerCase();
  if (type.includes("xml") || trimmed.startsWith("<")) {
    return {
      ...empty,
      parseError: "XML webhook bodies are not documented by CEPT for this endpoint.",
      rawPayload: { _unparsed: trimmed.slice(0, 4000) },
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return {
      ...empty,
      parseError: "Body is not JSON.",
      rawPayload: { _unparsed: trimmed.slice(0, 4000) },
    };
  }

  const source = Array.isArray(json) ? json[0] : json;
  if (!source || typeof source !== "object") {
    return { ...empty, parseError: "JSON body is not an object.", rawPayload: { _unparsed: json } };
  }

  const rawPayload = source as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of CEPT_FIELDS) {
    if (field in rawPayload) picked[field] = rawPayload[field];
  }

  return {
    provider: "INDIA_POST",
    channel,
    providerEventId: null,
    barcode: asText(rawPayload.article_number),
    eventCode: asText(rawPayload.event_code),
    eventDescription: asText(rawPayload.event_description),
    eventTimestamp: indiaPostWebhookEventTimestamp(asText(rawPayload.event_date), asText(rawPayload.event_time)),
    officeId: asText(rawPayload.event_office_facility_id),
    officeName: asText(rawPayload.event_office_name),
    customerId: asText(rawPayload.bulk_customer_id),
    contractId: asText(rawPayload.contract_number),
    nonDeliveryReason: asText(rawPayload.non_delivery_reason),
    parseError: null,
    rawPayload: Object.keys(picked).length ? picked : rawPayload,
  };
}

export function maskTrackingNumber(value?: string | null) {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

export function safeWebhookHeaders(headers: Headers) {
  const allowed = new Set([
    "content-type",
    "content-length",
    "user-agent",
    "x-request-id",
    "x-correlation-id",
    "date",
    "cf-connecting-ip",
    "x-real-ip",
  ]);
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (allowed.has(name)) out[name] = value;
  });
  return out;
}
