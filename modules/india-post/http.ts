export const INDIA_POST_TIMEOUT_MS = {
  login: 20_000,
  refresh: 20_000,
  search: 15_000,
  book: 10_000,
  label: 20_000,
  track: 30_000,
} as const;

/** Wall-clock cap for one article: CEPT book + official label. */
export const BOOKING_WITH_LABEL_MAX_MS = 20_000;
export const INLINE_LABEL_MIN_MS = 3_000;
export const INLINE_BOOKING_WAIT_MAX = 4;

/**
 * Ceilings for one booking POST. The file ceiling stays under the 300 s drain window
 * (`/api/cron/jobs` maxDuration) so a slow file upload cannot outlive its job run.
 */
export const INDIA_POST_BOOKING_TIMEOUT_MAX_MS = { json: 120_000, file: 280_000 } as const;
const BOOKING_TIMEOUT_PER_ARTICLE_MS = { json: 60, file: 50 } as const;
const FILE_BOOKING_BASE_MS = 30_000;

/**
 * Booking POST timeout for `articleCount` articles. One JSON article keeps the historical 10 s.
 * A timeout after the request left is an unknown outcome, so a large batch must not be cut short.
 */
export function indiaPostBookingTimeoutMs(articleCount: number, transport: "json" | "file" = "json") {
  const count = Math.max(1, Math.floor(Number(articleCount) || 1));
  if (transport === "file") {
    return Math.min(
      INDIA_POST_BOOKING_TIMEOUT_MAX_MS.file,
      FILE_BOOKING_BASE_MS + BOOKING_TIMEOUT_PER_ARTICLE_MS.file * count
    );
  }
  if (count === 1) return INDIA_POST_TIMEOUT_MS.book;
  return Math.min(
    INDIA_POST_BOOKING_TIMEOUT_MAX_MS.json,
    INDIA_POST_TIMEOUT_MS.book + BOOKING_TIMEOUT_PER_ARTICLE_MS.json * count
  );
}

export function indiaPostTimeoutSignal(ms: number) {
  return AbortSignal.timeout(ms);
}

export function shouldWaitForQueuedBookings(count: number) {
  return count > 0 && count <= INLINE_BOOKING_WAIT_MAX;
}

/** Remaining time for the inline CEPT label, or 0 to queue it instead of failing booking. */
export function inlineLabelTimeoutMs(
  startedAt: number,
  now = Date.now(),
  budget = BOOKING_WITH_LABEL_MAX_MS
) {
  const left = budget - (now - startedAt);
  if (left < INLINE_LABEL_MIN_MS) return 0;
  return Math.min(INDIA_POST_TIMEOUT_MS.label, left);
}
