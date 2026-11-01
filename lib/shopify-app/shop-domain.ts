export function normalizeShopifyShopDomain(value: string) {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "").trim().toLowerCase();
}

export function isShopifyShopDomain(hostname: string) {
  const host = normalizeShopifyShopDomain(hostname);
  return host.endsWith(".myshopify.com") && host.split(".").length >= 3 && !host.includes("/");
}

export function shopDomainFromIssuerOrDest(value: string) {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return normalizeShopifyShopDomain(url.hostname);
  } catch {
    return "";
  }
}

const STRICT_SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/;

/** Returns the shop domain only when it is safe to echo into headers (e.g. CSP), else null. */
export function strictShopDomain(value: string | null | undefined) {
  const host = (value ?? "").trim().toLowerCase();
  return STRICT_SHOP_DOMAIN.test(host) ? host : null;
}
