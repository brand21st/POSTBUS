export const SHOPIFY_RETRY_INVALID_SESSION_HEADER = "X-Shopify-Retry-Invalid-Session-Request";

export const SHOPIFY_APP_INSTALL_STATUSES = [
  "PENDING",
  "CONNECTED",
  "REAUTH_REQUIRED",
  "DISCONNECTED",
  "ERROR",
] as const;

export type ShopifyAppInstallStatus = (typeof SHOPIFY_APP_INSTALL_STATUSES)[number];

export const SHOPIFY_APP_ORG_ORIGIN = "SHOPIFY_PUBLIC_APP";

export const TOKEN_REFRESH_SKEW_MS = 60_000;

export const SHOPIFY_WEBHOOK_MAX_BODY_BYTES = 1_048_576;

/** Per client IP, before the session token is checked. */
export const SHOPIFY_APP_BFF_RATE_LIMIT = 300;
/** Per verified shop, shared across instances. A page load makes several calls; bulk work more. */
export const SHOPIFY_APP_SHOP_RATE_LIMIT = 240;
export const SHOPIFY_APP_WEBHOOK_RATE_LIMIT = 180;
