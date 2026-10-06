/**
 * WhatsApp platform-support eligibility (Phase 9).
 *
 * Canonical clock: `shipments.delivered_at` (set only when India Post tracking
 * applies operational_status DELIVERED). Null/empty means the consignment has
 * not actually been delivered — the order remains eligible.
 *
 * Window: 20 UTC calendar days, preserving time-of-day. UTC has no DST, so this
 * is `deliveredAt + 20 * 86_400_000 ms`. Inclusive at the exact boundary instant.
 * `now` is injected so tests stay deterministic; production passes current time.
 */

export const WHATSAPP_SUPPORT_WINDOW_CALENDAR_DAYS = 20;
export const WHATSAPP_SUPPORT_WINDOW_MS = WHATSAPP_SUPPORT_WINDOW_CALENDAR_DAYS * 86_400_000;

export type WhatsAppSupportEligibilityInput = {
  deliveredAt: Date | string | null | undefined;
  now: Date;
};

export type ShipmentEligibilityRow = {
  order_id?: unknown;
  delivered_at?: unknown;
  updated_at?: unknown;
};

export function isWhatsAppSupportEligible(input: WhatsAppSupportEligibilityInput): boolean {
  const raw = input.deliveredAt;
  if (raw == null || raw === "") return true;

  const deliveredMs = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
  if (!Number.isFinite(deliveredMs)) return false;

  const nowMs = input.now.getTime();
  if (!Number.isFinite(nowMs)) return false;
  if (deliveredMs > nowMs) return false;

  return nowMs <= deliveredMs + WHATSAPP_SUPPORT_WINDOW_MS;
}

export function currentShipmentDeliveredAt(
  shipments: ShipmentEligibilityRow[],
  orderId: string
): string | null {
  let best: { delivered_at: unknown; updatedMs: number } | null = null;
  for (const row of shipments) {
    if (String(row.order_id ?? "") !== orderId) continue;
    const updatedMs = Date.parse(String(row.updated_at ?? ""));
    const stamp = Number.isFinite(updatedMs) ? updatedMs : 0;
    if (!best || stamp > best.updatedMs) {
      best = { delivered_at: row.delivered_at, updatedMs: stamp };
    }
  }
  if (!best || best.delivered_at == null || best.delivered_at === "") return null;
  return String(best.delivered_at);
}
