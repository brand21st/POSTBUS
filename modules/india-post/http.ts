export const INDIA_POST_TIMEOUT_MS = {
  login: 20_000,
  search: 15_000,
  book: 45_000,
  label: 90_000,
  track: 30_000,
} as const;

export function indiaPostTimeoutSignal(ms: number) {
  return AbortSignal.timeout(ms);
}
