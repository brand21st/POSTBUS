/** Prints host/project identity only. Never prints secrets. */
import { readFileSync, existsSync } from "node:fs";

const PRODUCTION = "hgacoeoovjxkzfbesmvl";
const files = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.staging",
  ".env.staging.example",
  ".env.example",
];

function hostOf(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value ? "unparseable" : "";
  }
}

function scan(path: string) {
  if (!existsSync(path)) return { path, present: false };
  const text = readFileSync(path, "utf8");
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim().replace(/^"|"$/g, ""));
  }
  const supabase = map.get("NEXT_PUBLIC_SUPABASE_URL") || "";
  const app = map.get("NEXT_PUBLIC_APP_URL") || "";
  const razorpay = map.get("RAZORPAY_KEY_ID") || map.get("NEXT_PUBLIC_RAZORPAY_KEY_ID") || "";
  const host = hostOf(supabase);
  return {
    path,
    present: true,
    supabaseHost: host || "(unset)",
    productionSupabase: host.includes(PRODUCTION),
    appHost: hostOf(app) || "(unset)",
    razorpayMode: razorpay.startsWith("rzp_live_") ? "live" : razorpay.startsWith("rzp_test_") ? "test" : razorpay ? "unknown-prefix" : "(unset-in-file)",
    affiliatesFlag: map.get("POSTBUS_AFFILIATES_ENABLED") || "(unset)",
    accrualFlag: map.get("POSTBUS_AFFILIATE_ACCRUAL_ENABLED") || "(unset)",
    payoutsFlag: map.get("POSTBUS_AFFILIATE_PAYOUTS_ENABLED") || "(unset)",
    invoiceFlag: map.get("POSTBUS_BILLING_TAX_INVOICE_ENABLED") || "(unset)",
    stagingRef: map.get("AFFILIATE_STAGING_PROJECT_REF") ? "set" : "(unset)",
    writeAuth: map.get("AFFILIATE_STAGING_WRITE_AUTHORIZATION") ? "set" : "(unset)",
  };
}

const rows = files.map(scan);
console.log(JSON.stringify({ productionRef: PRODUCTION, files: rows }, null, 2));
