import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export function webhookCanonical(timestamp: string, eventId: string, rawBody: string) {
  return `${timestamp}.${eventId}.${rawBody}`;
}

export function signWebhook(secret: string, timestamp: string, eventId: string, rawBody: string) {
  return createHmac("sha256", secret).update(webhookCanonical(timestamp, eventId, rawBody)).digest("hex");
}

export function webhookSignatureHeader(secret: string, timestamp: string, eventId: string, rawBody: string) {
  return `v1=${signWebhook(secret, timestamp, eventId, rawBody)}`;
}

export function webhookTimestampFresh(timestamp: string, now = Date.now(), windowMs = WEBHOOK_TIMESTAMP_TOLERANCE_MS) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return false;
  return Math.abs(now - value) <= windowMs;
}

export function webhookSignaturesMatch(expectedHex: string, providedHeader: string) {
  const provided = providedHeader.trim().replace(/^v1=/, "");
  const left = Buffer.from(expectedHex);
  const right = Buffer.from(provided);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
