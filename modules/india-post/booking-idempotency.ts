import { isIndiaPostAcceptedStatus } from "@/modules/india-post/booking-status";
import { isIndiaPostDuplicateArticleMessage } from "@/modules/india-post/error-text";

export { isIndiaPostDuplicateArticleMessage };

export const BOOKING_CLAIMABLE_STATUSES = ["DRAFT", "VALIDATING", "QUEUED", "FAILED"] as const;

export function shipmentBarcode(value?: string | null) {
  return String(value ?? "").trim().toUpperCase();
}

/** Authoritative: CEPT already accepted this article. Status FAILED + booked_at still counts. */
export function isAuthoritativeIndiaPostBooking(row: {
  status?: string | null;
  barcode?: string | null;
  booked_at?: string | null;
  tracking_number?: string | null;
}) {
  const barcode = shipmentBarcode(row.barcode) || shipmentBarcode(row.tracking_number);
  if (!barcode) return false;
  if (row.booked_at) return true;
  return isIndiaPostAcceptedStatus(row.status);
}

const UNKNOWN_BOOKING_STATUSES = new Set(["BOOKING", "RECOVERY_REQUIRED"]);

/** CAS already took the row; CEPT outcome is not persisted. Do not POST book again unless recovery allows it. */
export function isIndiaPostBookingUnknown(row: {
  status?: string | null;
  barcode?: string | null;
  booked_at?: string | null;
}) {
  return (
    UNKNOWN_BOOKING_STATUSES.has(String(row.status ?? "").toUpperCase()) &&
    Boolean(shipmentBarcode(row.barcode)) &&
    !row.booked_at
  );
}

/**
 * Empty tracking is not proof the article was rejected.
 * A second CEPT POST is allowed only via trackingConfirmedNotBooked().
 */
export function canRetryCeptPostAfterUnknown(row?: { last_error_code?: string | null }) {
  void row;
  return false;
}

/** Tracking explicitly proved this article was not accepted. Empty/unavailable results are not proof. */
export function trackingConfirmedNotBooked(result: unknown, barcode: string) {
  if (trackingHasArticle(result, barcode)) return false;
  if (result == null) return false;
  const rec = result as { message?: string; error?: string };
  const message = String(rec.message ?? rec.error ?? "");
  return /not found|no record|article not booked|not booked/i.test(message);
}

export function barcodeLogRef(barcode?: string | null) {
  const value = shipmentBarcode(barcode);
  if (value.length < 4) return value ? "***" : undefined;
  return `***${value.slice(-4)}`;
}

export function trackingHasArticle(result: unknown, barcode: string) {
  const want = shipmentBarcode(barcode);
  if (!want || result == null) return false;
  const rec = result as { data?: unknown };
  const rows = Array.isArray(result) ? result : Array.isArray(rec.data) ? rec.data : [result];
  return rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    const article = row as {
      barcode_no?: unknown;
      article_number?: unknown;
      booking_details?: { article_number?: unknown };
    };
    const found = [
      article.barcode_no,
      article.article_number,
      article.booking_details?.article_number,
    ]
      .map((value) => shipmentBarcode(String(value ?? "")))
      .filter(Boolean);
    return found.includes(want);
  });
}
