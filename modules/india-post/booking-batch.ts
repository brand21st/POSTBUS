import { env } from "@/lib/env";
import { INDIA_POST_FILE_BOOKING_MAX, INDIA_POST_JSON_BOOKING_MAX } from "@/modules/india-post/spec";

export function indiaPostBookingBatchSize() {
  const raw = Number(env.indiaPostBookingBatchSize);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(INDIA_POST_FILE_BOOKING_MAX, Math.max(1, Math.floor(raw)));
}

export function indiaPostBookingConcurrency() {
  const raw = Number(env.indiaPostBookingConcurrency);
  if (!Number.isFinite(raw)) return 4;
  return Math.min(20, Math.max(1, Math.floor(raw)));
}

export function chunkIds<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  const n = Math.max(1, size);
  for (let index = 0; index < items.length; index += n) {
    chunks.push(items.slice(index, index + n));
  }
  return chunks;
}

export function indiaPostBookingTransport(articleCount: number): "json" | "file" {
  if (articleCount > INDIA_POST_JSON_BOOKING_MAX) return "file";
  return "json";
}
