import { readFileSync } from "node:fs";
import { PRODUCTION_SUPABASE_REF, supabaseProjectRefFromUrl } from "../lib/env/staging-isolation.ts";

function parseDotEnv(text: string) {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim().replace(/^"|"$/g, ""));
  }
  return map;
}

function maskId(value: string) {
  if (!value) return "(empty)";
  if (value.length <= 8) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const env = parseDotEnv(readFileSync(".env.local", "utf8"));
const supabaseUrl = env.get("NEXT_PUBLIC_SUPABASE_URL") || "";
const host = hostOf(supabaseUrl);
const ref = supabaseProjectRefFromUrl(supabaseUrl);
const loopback = host === "127.0.0.1" || host === "localhost";
const clientId = env.get("SHOPIFY_PUBLIC_APP_CLIENT_ID") || "";

process.stdout.write(
  `${JSON.stringify(
    {
      envLocalExists: true,
      shopifyPublicAppClientIdMasked: maskId(clientId),
      shopifyPublicAppClientIdLength: clientId.length,
      shopifyPublicAppClientIdIsPlaceholder: !clientId || clientId.includes("REPLACE"),
      shopifyPublicAppSecretPresent: Boolean((env.get("SHOPIFY_PUBLIC_APP_CLIENT_SECRET") || "").trim()),
      shopifyEmbeddedAppEnabled: (env.get("SHOPIFY_EMBEDDED_APP_ENABLED") || "").toLowerCase() === "true",
      nextPublicAppUrl: env.get("NEXT_PUBLIC_APP_URL") || "",
      supabaseHost: host || "(missing)",
      supabaseProjectRef: ref || "(none-not-hosted)",
      supabaseIsLoopback: loopback,
      supabaseIsProductionRef: ref === PRODUCTION_SUPABASE_REF,
      productionRefForbidden: PRODUCTION_SUPABASE_REF,
      byoShopifyApiKeyPresent: Boolean((env.get("SHOPIFY_API_KEY") || "").trim()),
      byoShopifyApiSecretPresent: Boolean((env.get("SHOPIFY_API_SECRET") || "").trim()),
    },
    null,
    2
  )}\n`
);
