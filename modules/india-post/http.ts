export const INDIA_POST_TIMEOUT_MS = {
  login: 20_000,
  search: 15_000,
  book: 10_000,
  label: 20_000,
  track: 30_000,
} as const;

/** Wall-clock cap for one article: CEPT book + official label. */
export const BOOKING_WITH_LABEL_MAX_MS = 20_000;
export const INLINE_LABEL_MIN_MS = 3_000;
export const INLINE_BOOKING_WAIT_MAX = 4;

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
