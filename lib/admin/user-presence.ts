export const USER_ONLINE_WINDOW_MS = 2 * 60 * 1000;
export const PRESENCE_WRITE_MIN_MS = 45_000;

export function isUserOnline(lastActiveAt: string | null | undefined, now = Date.now()) {
  if (!lastActiveAt) return false;
  const t = Date.parse(lastActiveAt);
  return Number.isFinite(t) && now - t <= USER_ONLINE_WINDOW_MS;
}

export function shouldWritePresence(lastActiveAt: string | null | undefined, now = Date.now()) {
  if (!lastActiveAt) return true;
  const t = Date.parse(lastActiveAt);
  if (!Number.isFinite(t)) return true;
  return now - t >= PRESENCE_WRITE_MIN_MS;
}

export function latestLastActiveAt(values: Array<string | null | undefined>) {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || ms <= latestMs) continue;
    latestMs = ms;
    latest = value;
  }
  return latest;
}
