export const SHOPIFY_ORDER_NOTIFICATION = "shopify.order_imported";

export function isShopifyOrderNotification(type?: string | null) {
  return type === SHOPIFY_ORDER_NOTIFICATION;
}

export function collectNewShopifyOrderAlerts<T extends { id: string; type?: string | null; createdAt?: string | null; created_at?: string | null }>(
  items: T[],
  seen: Set<string>,
  startedAt: number
) {
  const incoming = items.filter((item) => {
    if (!isShopifyOrderNotification(item.type) || seen.has(item.id)) return false;
    const created = Date.parse(String(item.createdAt ?? item.created_at ?? "")) || 0;
    return created > startedAt;
  });
  for (const item of items) seen.add(item.id);
  return incoming;
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

function tone(ctx: AudioContext, frequency: number, start: number, duration: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

export function playNewOrderSound() {
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const start = ctx.currentTime;
  tone(ctx, 880, start, 0.14);
  tone(ctx, 1174.66, start + 0.13, 0.22);
}
