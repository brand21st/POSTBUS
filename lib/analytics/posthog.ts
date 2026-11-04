import posthog from "posthog-js";

/**
 * PostHog product analytics: one place for init rules and every custom event.
 * Components call `trackPurchase` instead of `posthog.capture` so event names and
 * properties stay consistent and are covered by lib/analytics/posthog.test.ts.
 */

export const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

export type AnalyticsEnv = {
  token: string | undefined;
  host: string | undefined;
  pathname: string;
  hostname: string;
};

export type AnalyticsDecision = { enabled: true } | { enabled: false; reason: "no-token" | "shopify-embedded" | "local-dev" };

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isShopifyEmbeddedPath(pathname: string): boolean {
  return pathname === "/shopify" || pathname.startsWith("/shopify/");
}

export function analyticsDecision(env: AnalyticsEnv): AnalyticsDecision {
  if (!env.token?.trim()) return { enabled: false, reason: "no-token" };
  // Inside Shopify Admin (the embedded app) never record sessions or send product analytics:
  // pages show customer names and addresses, and the App Store requires that data stays put.
  if (isShopifyEmbeddedPath(env.pathname)) return { enabled: false, reason: "shopify-embedded" };
  // .env.local carries the production token, so local dev would otherwise pollute live analytics.
  if (LOCAL_HOSTNAMES.has(env.hostname) || env.hostname.endsWith(".localhost")) {
    return { enabled: false, reason: "local-dev" };
  }
  return { enabled: true };
}

export function posthogInitOptions(host: string | undefined) {
  return {
    api_host: host?.trim() || POSTHOG_DEFAULT_HOST,
    defaults: "2026-05-30",
    person_profiles: "identified_only",
  } as const;
}

/** Runs from instrumentation-client.ts. Returns whether PostHog was started. */
export function initAnalytics(env: AnalyticsEnv): boolean {
  const decision = analyticsDecision(env);
  if (!decision.enabled) return false;
  posthog.init(env.token!.trim(), posthogInitOptions(env.host));
  return true;
}

/** Shape the /api/v1/me response into what PostHog may know about the user. */
export function analyticsUserFromMe(me: {
  user: { id: string };
  organization?: { id: string } | null;
  role?: string | null;
  subscription?: { planCode?: string | null; status?: string | null } | null;
}): AnalyticsUser {
  return {
    userId: me.user.id,
    organizationId: me.organization?.id ?? null,
    role: me.role ?? null,
    planCode: me.subscription?.planCode ?? null,
    subscriptionStatus: me.subscription?.status ?? null,
  };
}

export type AnalyticsUser = {
  userId: string;
  organizationId?: string | null;
  role?: string | null;
  planCode?: string | null;
  subscriptionStatus?: string | null;
};

/** Person properties only: no email, name or phone ever leaves for PostHog. */
export function personProperties(user: AnalyticsUser): Record<string, string> {
  const props: Record<string, string> = {};
  if (user.organizationId) props.organization_id = user.organizationId;
  if (user.role) props.role = user.role;
  if (user.planCode) props.plan_code = user.planCode;
  if (user.subscriptionStatus) props.subscription_status = user.subscriptionStatus;
  return props;
}

/** posthog-js methods are unsafe before init (local dev, Shopify Admin, no token). */
function posthogReady(): boolean {
  return Boolean((posthog as { __loaded?: boolean }).__loaded);
}

/**
 * Ties this browser's events to the signed-in account. Safe to call on every render that
 * changes the user: it re-sends only when the distinct id or person properties change.
 */
let lastIdentified = "";
export function identifyUser(user: AnalyticsUser): boolean {
  if (!posthogReady() || !user.userId) return false;
  const props = personProperties(user);
  const key = `${user.userId}|${JSON.stringify(props)}`;
  if (key === lastIdentified) return false;
  lastIdentified = key;
  posthog.identify(user.userId, props);
  return true;
}

/** Call on sign-out so the next person on this device starts as a fresh anonymous visitor. */
export function resetAnalyticsUser(): void {
  lastIdentified = "";
  if (!posthogReady()) return;
  posthog.reset();
}

export type PurchaseProduct = "plan" | "ai-credits" | "addon:ai-accountant";

export const PURCHASE_EVENTS = {
  plan: "purchase_completed",
  "ai-credits": "purchase_completed",
  "addon:ai-accountant": "addon_purchase_completed",
} as const satisfies Record<PurchaseProduct, string>;

/**
 * Call after /api/v1/billing/verify succeeds. Sent immediately (not batched) because the
 * plan checkout reloads the page right after, which can drop a queued event.
 */
export function trackPurchase(product: PurchaseProduct, amountPaise: number, extra: Record<string, string | number> = {}) {
  const properties: Record<string, string | number> = {
    product,
    amount: amountPaise / 100,
    currency: "INR",
    ...extra,
  };
  if (product === "addon:ai-accountant") properties.addon = "ai-accountant";
  posthog.capture(PURCHASE_EVENTS[product], properties, { send_instantly: true });
}
