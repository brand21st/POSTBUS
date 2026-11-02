export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function serviceWindowExpiresAt(lastCustomerMessageAt: Date | string | null | undefined) {
  if (!lastCustomerMessageAt) return null;
  const at = typeof lastCustomerMessageAt === "string" ? new Date(lastCustomerMessageAt) : lastCustomerMessageAt;
  if (Number.isNaN(at.getTime())) return null;
  return new Date(at.getTime() + CUSTOMER_SERVICE_WINDOW_MS);
}

export function isServiceWindowOpen(expiresAt: Date | string | null | undefined, now = new Date()) {
  if (!expiresAt) return false;
  const at = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() > now.getTime();
}

export function remainingWindowMs(expiresAt: Date | string | null | undefined, now = new Date()) {
  if (!isServiceWindowOpen(expiresAt, now)) return 0;
  const at = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt!;
  return Math.max(0, at.getTime() - now.getTime());
}

export function shouldAdvanceCustomerTimestamp(
  current: string | null | undefined,
  incoming: string | Date | null | undefined
) {
  if (!incoming) return false;
  const next = typeof incoming === "string" ? incoming : incoming.toISOString();
  if (!current) return true;
  return new Date(next).getTime() >= new Date(current).getTime();
}
