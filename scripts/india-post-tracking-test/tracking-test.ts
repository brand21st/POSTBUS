import { REQUEST_TIMEOUT_MS, sessionUrl, type DiagnosticConfig } from "./env";
import { firstText, sanitizeJson } from "./sanitize";
import { indiaPostFetch, TokenManager, type HttpCallResult } from "./token-manager";

export type TrackingArticle = {
  articleNumber?: string;
  bookingOffice?: string;
  bookingDate?: string;
  originPin?: string;
  destinationPin?: string;
  deliveryStatus?: string;
  rts?: string;
  events: Array<{
    date?: string;
    time?: string;
    office?: string;
    event?: string;
    remarks?: string;
    rts?: string;
  }>;
};

export type TrackingTestResult = {
  barcode: string;
  httpStatus: number;
  success: boolean;
  requestMethod: "GET" | "POST";
  requestUrl: string;
  authorizationFormat: "Bearer access_token" | "missing";
  usedFreshLoginRetry: boolean;
  tokenSource: "FRESH_LOGIN" | "TOKEN_REFRESH" | "NONE";
  sanitized: unknown;
  article: TrackingArticle | null;
  errorMessage?: string;
  call: HttpCallResult | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function articleList(json: unknown): unknown[] {
  const root = asRecord(json);
  const data = root?.data ?? root?.Data ?? root?.articles ?? json;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return [data];
  return [];
}

function eventRows(article: Record<string, unknown>) {
  const raw = article.tracking_details ?? article.trackingDetails ?? article.event_details ?? article.events;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

export function parseTrackingArticle(json: unknown, barcode: string): TrackingArticle | null {
  const wanted = barcode.replace(/\s+/g, "").toUpperCase();
  const articles = articleList(json)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  if (!articles.length) return null;
  const match =
    articles.find((article) => {
      const booking = asRecord(article.booking_details) ?? {};
      const number = firstText(
        article.article_number,
        article.articleNumber,
        booking.article_number,
        booking.articleNumber,
        article.barcode
      );
      return number?.replace(/\s+/g, "").toUpperCase() === wanted;
    }) ?? null;
  if (!match) {
    const only = articles[0];
    const booking = asRecord(only.booking_details) ?? {};
    const hasArticle = Boolean(
      firstText(only.article_number, only.articleNumber, booking.article_number, only.barcode) ||
        eventRows(only).length
    );
    if (!hasArticle) return null;
  }
  const article = match ?? articles[0];
  const booking = asRecord(article.booking_details) ?? {};
  const del = asRecord(article.del_status) ?? {};
  const events = eventRows(article)
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => ({
      date: firstText(row.date, row.event_date, row.eventDate),
      time: firstText(row.time, row.event_time, row.eventTime),
      office: firstText(row.office, row.event_office_name, row.office_name),
      event: firstText(row.event, row.event_description, row.eventDescription, row.status),
      remarks: firstText(row.remarks),
      rts: row.rts == null ? undefined : String(row.rts),
    }));
  events.sort((a, b) => `${a.date ?? ""} ${a.time ?? ""}`.localeCompare(`${b.date ?? ""} ${b.time ?? ""}`));
  return {
    articleNumber: firstText(article.article_number, booking.article_number),
    bookingOffice: firstText(
      booking.booking_office,
      booking.bookingOffice,
      booking.booked_at,
      booking.office
    ),
    bookingDate: firstText(booking.booking_date, booking.bookingDate, booking.booked_on, booking.date),
    originPin: firstText(booking.origin_pin, booking.origin_pincode, booking.sender_pin),
    destinationPin: firstText(
      booking.destination_pin,
      booking.destination_pincode,
      booking.receiver_pin
    ),
    deliveryStatus: firstText(del.del_status, article.delivery_status, booking.delivery_status),
    rts: booking.rts == null && article.rts == null ? undefined : String(booking.rts ?? article.rts),
    events,
  };
}

export function formatTrackingBlock(result: TrackingTestResult) {
  const lines = [
    "INDIA POST TRACKING TEST",
    "------------------------------",
    "",
    `Barcode: ${result.barcode}`,
    "",
    `API Status: ${result.httpStatus}`,
    "",
    `Tracking Result: ${result.success ? "SUCCESS" : "FAILED"}`,
    `Authorization: ${result.authorizationFormat}`,
    `Token source: ${result.tokenSource}`,
  ];
  if (result.errorMessage) lines.push(`Error: ${result.errorMessage}`);
  const article = result.article;
  if (!article) {
    lines.push("", "No tracking article fields were present in the sanitized response.");
    return lines.join("\n");
  }
  if (article.bookingOffice) lines.push(`Booking Office: ${article.bookingOffice}`);
  if (article.bookingDate) lines.push(`Booking Date: ${article.bookingDate}`);
  if (article.originPin) lines.push(`Origin PIN Code: ${article.originPin}`);
  if (article.destinationPin) lines.push(`Destination PIN Code: ${article.destinationPin}`);
  if (article.deliveryStatus) lines.push(`Current Status: ${article.deliveryStatus}`);
  if (article.rts) lines.push(`Return to Sender Indicator: ${article.rts}`);
  if (article.events.length) {
    lines.push("", "Tracking History:");
    article.events.forEach((event, index) => {
      const parts = [event.event, event.office, [event.date, event.time].filter(Boolean).join(" "), event.remarks]
        .filter(Boolean)
        .join(" | ");
      lines.push(`${index + 1}. ${parts || "(event row present, no documented fields)"}`);
    });
  }
  return lines.join("\n");
}

export async function testTrackingAPI(
  config: DiagnosticConfig,
  manager: TokenManager,
  barcode: string
): Promise<TrackingTestResult> {
  const { token, source } = await manager.getValidAccessToken();
  const url = sessionUrl(config.apiRoot, "/tracking/bulk");
  const call = await indiaPostFetch(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bulk: [barcode] }),
    },
    REQUEST_TIMEOUT_MS.track,
    "access_token"
  );
  const article = parseTrackingArticle(call.json, barcode);
  const envelopeSuccess = asRecord(call.json)?.success === true;
  const success = call.ok && (envelopeSuccess || Boolean(article));
  return {
    barcode,
    httpStatus: call.httpStatus,
    success,
    requestMethod: "POST",
    requestUrl: url,
    authorizationFormat: "Bearer access_token",
    usedFreshLoginRetry: false,
    tokenSource: source,
    sanitized: sanitizeJson(call.json) ?? call.text.slice(0, 500),
    article,
    errorMessage: success ? undefined : firstText(asRecord(call.json)?.message, asRecord(asRecord(call.json)?.error)?.message) || `HTTP ${call.httpStatus}`,
    call,
  };
}

/**
 * TNT01 Track Single Article.
 * Dashboard: GET {base}/v1/tracking/
 * PostBus CEPT stub and prior provider tests: barcode is a path parameter.
 * Approach document does not specify TNT01; do not use query params or TNT02.
 */
export function tnt01Url(config: DiagnosticConfig, barcode: string) {
  return sessionUrl(config.apiRoot, `/tracking/${encodeURIComponent(barcode)}`);
}

export async function testTnt01TrackingAPI(
  config: DiagnosticConfig,
  manager: TokenManager,
  barcode: string
): Promise<TrackingTestResult> {
  const { token, source } = await manager.getValidAccessToken();
  const url = tnt01Url(config, barcode);
  if (url.includes("/tracking/bulk")) {
    throw new Error("TNT01 diagnostic refused to call TNT02 /tracking/bulk.");
  }
  const call = await indiaPostFetch(
    url,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
    REQUEST_TIMEOUT_MS.track,
    "access_token"
  );
  const article = parseTrackingArticle(call.json, barcode);
  const envelopeSuccess = asRecord(call.json)?.success === true;
  const success = call.ok && (envelopeSuccess || Boolean(article));
  return {
    barcode,
    httpStatus: call.httpStatus,
    success,
    requestMethod: "GET",
    requestUrl: url,
    authorizationFormat: "Bearer access_token",
    usedFreshLoginRetry: false,
    tokenSource: source,
    sanitized: sanitizeJson(call.json) ?? call.text.slice(0, 800),
    article,
    errorMessage:
      success
        ? undefined
        : firstText(asRecord(call.json)?.message, asRecord(asRecord(call.json)?.error)?.message) ||
          `HTTP ${call.httpStatus}`,
    call,
  };
}

export function formatTnt01Block(input: {
  customerId: string;
  loginStatus: "SUCCESS" | "FAILED";
  tokenStatus: "VALID" | "INVALID";
  result: TrackingTestResult;
}) {
  const lines = [
    "INDIA POST TNT01 TRACKING TEST",
    "------------------------------",
    "",
    `Customer ID: ${input.customerId || "(not set)"}`,
    `Barcode: ${input.result.barcode}`,
    `Request: ${input.result.requestMethod} ${input.result.requestUrl}`,
    `Barcode parameter: path /v1/tracking/{barcode}`,
    `Login Status: ${input.loginStatus}`,
    `Token Status: ${input.tokenStatus}`,
    `Tracking HTTP Status: ${input.result.httpStatus}`,
    `Token source: ${input.result.tokenSource}`,
  ];
  if (input.result.errorMessage) lines.push(`Error: ${input.result.errorMessage}`);
  lines.push("", "Tracking API Response:", JSON.stringify(input.result.sanitized, null, 2));
  const article = input.result.article;
  if (!article) {
    lines.push("", "No tracking article fields were present in the response.");
    return lines.join("\n");
  }
  lines.push("", "Tracking details:");
  if (article.articleNumber) lines.push(`Article Number: ${article.articleNumber}`);
  if (article.bookingDate) lines.push(`Booking Date: ${article.bookingDate}`);
  if (article.bookingOffice) lines.push(`Booking Office: ${article.bookingOffice}`);
  if (article.originPin) lines.push(`Origin: ${article.originPin}`);
  if (article.destinationPin) lines.push(`Destination: ${article.destinationPin}`);
  if (article.deliveryStatus) lines.push(`Current Delivery Status: ${article.deliveryStatus}`);
  if (article.rts) lines.push(`Return to Sender Indicator: ${article.rts}`);
  if (article.events.length) {
    lines.push("", "Tracking Events:");
    article.events.forEach((event, index) => {
      lines.push(
        `${index + 1}. ${[
          event.event,
          event.office ? `Office: ${event.office}` : null,
          event.date ? `Date: ${event.date}` : null,
          event.time ? `Time: ${event.time}` : null,
          event.remarks ? `Remarks: ${event.remarks}` : null,
        ]
          .filter(Boolean)
          .join(" | ")}`
      );
    });
  }
  return lines.join("\n");
}

export async function testPincodeControl(
  config: DiagnosticConfig,
  manager: TokenManager
): Promise<{ httpStatus: number; success: boolean; sanitized: unknown; call: HttpCallResult }> {
  const { token } = await manager.getValidAccessToken();
  const params = new URLSearchParams({ pincode: config.controlPincode, "office-type": "post" });
  const url = `${sessionUrl(config.apiRoot, "/pincode-search")}?${params}`;
  const call = await indiaPostFetch(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    REQUEST_TIMEOUT_MS.search,
    "access_token"
  );
  return {
    httpStatus: call.httpStatus,
    success: call.ok,
    sanitized: sanitizeJson(call.json) ?? call.text.slice(0, 300),
    call,
  };
}
