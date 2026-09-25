import { LABELS_READY_NOTIFICATION } from "@/lib/notifications/labels-ready";

export const SHOPIFY_ORDER_NOTIFICATION = "shopify.order_imported";
export { LABELS_READY_NOTIFICATION };

export const DASHBOARD_ALERT_TYPES = new Set([
  SHOPIFY_ORDER_NOTIFICATION,
  "order.processing",
  "shipment.booked",
  "shipment.in_transit",
  "shipment.delivered",
  LABELS_READY_NOTIFICATION,
]);

export function isShopifyOrderNotification(type?: string | null) {
  return type === SHOPIFY_ORDER_NOTIFICATION;
}

export function isDashboardAlertNotification(type?: string | null) {
  return Boolean(type && DASHBOARD_ALERT_TYPES.has(type));
}

export function collectDashboardAlerts<
  T extends { id: string; type?: string | null; createdAt?: string | null; created_at?: string | null },
>(items: T[], seen: Set<string>, startedAt: number) {
  const incoming = items.filter((item) => {
    if (!isDashboardAlertNotification(item.type) || seen.has(item.id)) return false;
    if (startedAt <= 0) return true;
    const created = Date.parse(String(item.createdAt ?? item.created_at ?? ""));
    if (!Number.isFinite(created)) return true;
    return created > startedAt;
  });
  for (const item of items) seen.add(item.id);
  return incoming;
}

export function collectNewShopifyOrderAlerts<
  T extends { id: string; type?: string | null; createdAt?: string | null; created_at?: string | null },
>(items: T[], seen: Set<string>, startedAt: number) {
  return collectDashboardAlerts(items, seen, startedAt);
}

let sharedContext: AudioContext | null = null;

function audioContext() {
  const Ctor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
}

export function unlockNewOrderSound() {
  const ctx = audioContext();
  if (ctx?.state === "suspended") void ctx.resume();
}

async function primedContext() {
  const ctx = audioContext();
  if (!ctx) return null;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      return null;
    }
  }
  return ctx;
}

function tone(
  ctx: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  options?: { type?: OscillatorType; peak?: number }
) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const peak = options?.peak ?? 0.18;
  oscillator.type = options?.type ?? "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

export async function playNewOrderSound() {
  const ctx = await primedContext();
  if (!ctx) return;
  const start = ctx.currentTime;
  tone(ctx, 880, start, 0.14);
  tone(ctx, 1174.66, start + 0.13, 0.22);
}

/** Resolved major-triad chime — distinct from the new-order ping. */
export async function playCompletionSound() {
  const ctx = await primedContext();
  if (!ctx) return;
  const start = ctx.currentTime;
  tone(ctx, 523.25, start, 0.18, { type: "triangle", peak: 0.1 });
  tone(ctx, 659.25, start + 0.14, 0.2, { type: "triangle", peak: 0.12 });
  tone(ctx, 783.99, start + 0.28, 0.42, { type: "triangle", peak: 0.14 });
  tone(ctx, 1046.5, start + 0.28, 0.46, { type: "sine", peak: 0.05 });
}

export function usesCompletionSound(types: Array<string | null | undefined>) {
  return types.some((type) => type === LABELS_READY_NOTIFICATION);
}

export async function playDashboardAlertSound(types: Array<string | null | undefined>) {
  if (usesCompletionSound(types)) {
    await playCompletionSound();
    return;
  }
  await playNewOrderSound();
}
