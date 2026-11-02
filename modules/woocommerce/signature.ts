import { createHmac, timingSafeEqual } from "node:crypto";

export function wooWebhookSignature(secret: string, rawBody: string) {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

export function verifyWooWebhookSignature(secret: string, rawBody: string, header: string | null) {
  if (!secret || !header) return false;
  const expected = wooWebhookSignature(secret, rawBody);
  const left = Buffer.from(expected);
  const right = Buffer.from(header.trim());
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const POSTBUS_META_KEYS = [
  "_postbus_tracking_number",
  "_postbus_tracking_url",
  "_postbus_carrier",
] as const;

export function isPostbusEchoUpdate(input: {
  previousStatus?: string | null;
  nextStatus?: string | null;
  previousTotal?: string | number | null;
  nextTotal?: string | number | null;
  meta?: Array<{ key?: string; value?: unknown }> | null;
}) {
  const meta = input.meta ?? [];
  const hasPostbusMeta = meta.some((row) =>
    POSTBUS_META_KEYS.includes(String(row.key) as (typeof POSTBUS_META_KEYS)[number])
  );
  if (!hasPostbusMeta) return false;
  const statusSame = (input.previousStatus ?? "") === (input.nextStatus ?? "");
  const totalSame = String(input.previousTotal ?? "") === String(input.nextTotal ?? "");
  return statusSame && totalSame;
}

export function shouldApplyWooOrder(input: {
  topic: string;
  incomingModified?: string | null;
  storedModified?: string | null;
}) {
  if (input.topic === "order.deleted") return true;
  if (!input.incomingModified || !input.storedModified) return true;
  const incoming = Date.parse(input.incomingModified);
  const stored = Date.parse(input.storedModified);
  if (Number.isNaN(incoming) || Number.isNaN(stored)) return true;
  return incoming >= stored;
}
