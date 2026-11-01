// Relative on purpose: next.config.ts loads this file and its loader does not resolve "@/" aliases.
import { strictShopDomain } from "../shopify-app/shop-domain";

export type HeaderEntry = { key: string; value: string };

/** Only Shopify admin and the requesting shop may frame the embedded app. */
export function shopifyFrameAncestors(shop?: string | null) {
  const sources = ["https://admin.shopify.com"];
  const domain = strictShopDomain(shop);
  if (domain) sources.unshift(`https://${domain}`);
  return sources.join(" ");
}

export function isShopifyEmbeddedPath(pathname: string) {
  return pathname === "/shopify" || pathname.startsWith("/shopify/") || pathname.startsWith("/api/shopify");
}

/** The dashboard Storefront tab frames this page to preview unsaved settings; only same-origin parents may embed it. */
export const STOREFRONT_PREVIEW_PATH = "/store-preview";

export function isSameOriginFramePath(pathname: string) {
  return pathname === STOREFRONT_PREVIEW_PATH;
}

function supabaseConnectSources() {
  const sources = new Set(["https://*.supabase.co", "wss://*.supabase.co"]);
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return [...sources];
  try {
    const origin = new URL(raw).origin;
    sources.add(origin);
    sources.add(origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:"));
  } catch {
    // keep wildcard fallbacks
  }
  return [...sources];
}

export function contentSecurityPolicy(options?: { embedShopify?: boolean; shop?: string | null; frameSelf?: boolean }) {
  const connectSrc = [
    "'self'",
    ...supabaseConnectSources(),
    "https://www.clarity.ms",
    "https://*.clarity.ms",
    "https://c.bing.com",
    "https://*.bing.com",
    "https://www.google-analytics.com",
    "https://analytics.google.com",
    "https://region1.google-analytics.com",
    "https://static.cloudflareinsights.com",
    "https://cloudflareinsights.com",
    "https://*.myshopify.com",
    "https://*.shopify.com",
    "https://api.razorpay.com",
    "https://lumberjack.razorpay.com",
    "https://api.stripe.com",
  ].join(" ");

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    // React/Next reconstruct call stacks with eval() in development only.
    ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"]),
    "https://www.clarity.ms",
    "https://scripts.clarity.ms",
    "https://*.clarity.ms",
    "https://www.googletagmanager.com",
    "https://static.cloudflareinsights.com",
    "https://checkout.razorpay.com",
    "https://cdn.jsdelivr.net",
    ...(options?.embedShopify ? ["https://cdn.shopify.com"] : []),
  ].join(" ");

  const styleSrc = [
    "'self'",
    "'unsafe-inline'",
    "https://fonts.googleapis.com",
    "https://cdn.jsdelivr.net",
    ...(options?.embedShopify ? ["https://cdn.shopify.com"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    options?.embedShopify
      ? `frame-ancestors ${shopifyFrameAncestors(options.shop)}`
      : options?.frameSelf
        ? "frame-ancestors 'self'"
        : "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    "img-src 'self' data: blob: https:",
    options?.embedShopify
      ? "font-src 'self' data: https://fonts.gstatic.com https://cdn.shopify.com"
      : "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob: https://api.razorpay.com https://checkout.razorpay.com https://js.stripe.com https://hooks.stripe.com https://*.myshopify.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.facebook.com https://www.instagram.com",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function applySecurityHeaders(
  headers: Headers,
  options?: { includeHsts?: boolean; pathname?: string; shop?: string | null }
) {
  const embedShopify =
    Boolean(options?.pathname) &&
    isShopifyEmbeddedPath(options!.pathname!) &&
    process.env.SHOPIFY_EMBEDDED_APP_ENABLED?.toLowerCase() === "true";
  const frameSelf = !embedShopify && Boolean(options?.pathname) && isSameOriginFramePath(options!.pathname!);
  for (const header of securityHeaderEntries({ ...options, embedShopify, frameSelf })) {
    headers.set(header.key, header.value);
  }
  if (embedShopify) {
    headers.delete("X-Frame-Options");
  }
  return headers;
}

export function securityHeaderEntries(options?: {
  includeHsts?: boolean;
  embedShopify?: boolean;
  shop?: string | null;
  frameSelf?: boolean;
}): HeaderEntry[] {
  const includeHsts = options?.includeHsts ?? process.env.NODE_ENV === "production";
  const embedShopify = Boolean(options?.embedShopify);
  const frameSelf = !embedShopify && Boolean(options?.frameSelf);
  const headers: HeaderEntry[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    {
      key: "Cross-Origin-Resource-Policy",
      value: embedShopify ? "cross-origin" : "same-origin",
    },
    { key: "X-DNS-Prefetch-Control", value: "on" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy({ embedShopify, shop: options?.shop, frameSelf }) },
  ];
  if (!embedShopify) {
    headers.splice(1, 0, { key: "X-Frame-Options", value: frameSelf ? "SAMEORIGIN" : "DENY" });
  }
  if (includeHsts) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }
  return headers;
}
