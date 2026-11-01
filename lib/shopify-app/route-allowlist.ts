/**
 * v1 tenant routes the Shopify embedded app may call through /api/shopify/v1/*.
 * Anything not listed is a 404 for the app, even though the dashboard can reach it.
 * Deliberately excluded: Razorpay checkout (App Store apps must bill through Shopify),
 * members/api-keys/webhooks admin, print agent, AI, WhatsApp, support, invoices.
 */
const ID = "[^/]+";

const ROUTES: ReadonlyArray<readonly [method: string, pattern: string]> = [
  // Home
  ["GET", "dashboard/kpis"],
  ["GET", "dashboard/pipeline"],
  ["GET", "dashboard/analytics"],
  // Orders + booking inputs
  ["GET", "orders"],
  ["GET", `orders/${ID}`],
  ["PATCH", `orders/${ID}/(service|weights|address|dimensions)`],
  ["POST", `orders/${ID}/tariff-quote`],
  ["GET", "india-post/tariff-capabilities"],
  // Bulk booking
  ["POST", "bookings/validate"],
  ["POST", "bookings/queue"],
  ["GET", "bookings/summary"],
  // Shipments
  ["GET", "shipments"],
  ["POST", "shipments"],
  ["GET", `shipments/${ID}`],
  ["PATCH", `shipments/${ID}`],
  ["POST", `shipments/${ID}/retry`],
  // Labels + manifests
  ["GET", "labels"],
  ["GET", `labels/${ID}/(download|latest|shipping-slip)`],
  ["POST", `labels/${ID}/india-post`],
  ["POST", "labels/bulk-download"],
  ["GET", "manifests"],
  ["POST", "manifests"],
  // Tracking + exceptions
  ["GET", "tracking"],
  ["GET", "ndr-rto"],
  ["GET", "ndr-rto/summary"],
  ["POST", `ndr-rto/${ID}/sync`],
  // India Post connection + defaults
  ["GET", "integrations/india-post"],
  ["POST", "integrations/india-post"],
  ["PUT", "integrations/india-post"],
  ["PATCH", "integrations/india-post"],
  ["DELETE", "integrations/india-post"],
  ["POST", "integrations/india-post/(verify|test)"],
  ["GET", "integrations/india-post/offices"],
  [
    "PATCH",
    "integrations/india-post/(parcel-defaults|booking-service|default-service|contracts|office|pickup-office|barcode-range)",
  ],
  // Settings
  ["GET", "automation"],
  ["PATCH", "automation"],
  // Plan + usage (read-only; Shopify Billing arrives separately)
  ["GET", "billing/plans"],
  ["GET", "billing/subscription"],
  ["GET", "billing/usage"],
];

const COMPILED = ROUTES.map(([method, pattern]) => ({ method, regex: new RegExp(`^${pattern}$`) }));

export function isShopifyAppRouteAllowed(method: string, path: string) {
  const upper = method.toUpperCase();
  return COMPILED.some((route) => route.method === upper && route.regex.test(path));
}
