/** Limits from India Post External Integrations Approach Document, updated 30.07.2026. */

export const INDIA_POST_BULK_REFERENCE_MAX = 50;
export const INDIA_POST_TRACKING_BULK_LIMIT = 500;
/** TNT02 per-request size. The CEPT API dashboard lists "up to 50 article IDs", below the document's 500. */
export const INDIA_POST_TRACKING_REQUEST_CHUNK = 50;
/** After TNT01/TNT02 return 403 entitlement, use Event Download for this long before retrying the tracking API. */
export const INDIA_POST_TRACKING_API_FORBIDDEN_COOLDOWN_MS = 10 * 60 * 1000;
/** Recurring Event Download window: today IST plus this many previous days. */
export const INDIA_POST_EVENT_DOWNLOAD_OVERLAP_DAYS = 2;
/** Historical Event Download window for daily reconciliation. */
export const INDIA_POST_EVENT_DOWNLOAD_LOOKBACK_DAYS = 7;
/** Independent of overlap polling. Overlap success must not reset this clock. */
export const INDIA_POST_EVENT_DOWNLOAD_LOOKBACK_INTERVAL_MS = 20 * 60 * 60 * 1000;
export const INDIA_POST_EVENT_DOWNLOAD_MAX_BYTES = 2_000_000;
export const INDIA_POST_EVENT_DOWNLOAD_REFRESH_COOLDOWN_MS = 60_000;
export const INDIA_POST_EVENT_DOWNLOAD_LEASE_TTL_SECONDS = 90;
export const INDIA_POST_EVENT_DOWNLOAD_LEASE_WAIT_MS = 8_000;

export function indiaPostEventDownloadLookbackDays() {
  const parsed = Number(process.env.INDIA_POST_EVENT_DOWNLOAD_LOOKBACK_DAYS);
  if (!Number.isFinite(parsed)) return INDIA_POST_EVENT_DOWNLOAD_LOOKBACK_DAYS;
  return Math.min(14, Math.max(2, Math.trunc(parsed)));
}

export function indiaPostEventDownloadLookbackIntervalMs() {
  const parsed = Number(process.env.INDIA_POST_EVENT_DOWNLOAD_LOOKBACK_INTERVAL_MS);
  if (!Number.isFinite(parsed) || parsed < 60_000) return INDIA_POST_EVENT_DOWNLOAD_LOOKBACK_INTERVAL_MS;
  return Math.trunc(parsed);
}
export const INDIA_POST_JSON_BOOKING_MAX = 999;
export const INDIA_POST_FILE_BOOKING_MAX = 5000;
export const INDIA_POST_ADDRESS_LINE_MAX = 80;
export const INDIA_POST_ADDRESS_COMBINED_MAX = 240;
export const INDIA_POST_DIMENSION_ABSOLUTE_MAX_CM = 150;
export const INDIA_POST_SPEED_POST_DOC_WEIGHT_MAX_G = 500;

export function indiaPostRequiresOtp(serviceCode: string) {
  return serviceCode.trim().toUpperCase() === "24_SPP_PARSPL";
}

/** JSON body placed in the CEPT file field. Does not call India Post. */
export function indiaPostArticlesFileJson(articles: unknown[]) {
  return JSON.stringify({ articles });
}
