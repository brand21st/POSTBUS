export type HeaderEntry = { key: string; value: string };

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

export function contentSecurityPolicy() {
  const connectSrc = [
    "'self'",
    ...supabaseConnectSources(),
    "https://www.clarity.ms",
    "https://*.clarity.ms",
    "https://c.bing.com",
    "https://*.bing.com",
    "https://static.cloudflareinsights.com",
    "https://cloudflareinsights.com",
    "https://*.myshopify.com",
    "https://*.shopify.com",
    "https://api.razorpay.com",
    "https://lumberjack.razorpay.com",
    "https://api.stripe.com",
  ].join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' https://www.clarity.ms https://scripts.clarity.ms https://*.clarity.ms https://static.cloudflareinsights.com https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://js.stripe.com https://hooks.stripe.com https://*.myshopify.com",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function applySecurityHeaders(headers: Headers, options?: { includeHsts?: boolean }) {
  for (const header of securityHeaderEntries(options)) {
    headers.set(header.key, header.value);
  }
  return headers;
}

export function securityHeaderEntries(options?: { includeHsts?: boolean }): HeaderEntry[] {
  const includeHsts = options?.includeHsts ?? process.env.NODE_ENV === "production";
  const headers: HeaderEntry[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "on" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  ];
  if (includeHsts) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }
  return headers;
}
