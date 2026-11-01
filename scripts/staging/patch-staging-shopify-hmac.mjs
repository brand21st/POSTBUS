/**
 * Ensure isolated HMAC test secrets exist in .env.staging.local.
 * Does not print secret values. Refuses production URLs.
 */
import { readFileSync, writeFileSync } from "node:fs";

const PRODUCTION_SUPABASE_REF = "hgacoeoovjxkzfbesmvl";
const file = ".env.staging.local";
let text = readFileSync(file, "utf8");
if (text.toLowerCase().includes(PRODUCTION_SUPABASE_REF)) {
  console.error("STOP: staging env mentions production project");
  process.exit(1);
}

function get(key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}
function set(key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, `${key}=${value}`);
  else text += `\n${key}=${value}\n`;
}

const TEST_PUBLIC = "postbus-staging-public-hmac-only";
set("SHOPIFY_API_SECRET", "");
set("SHOPIFY_API_KEY", "");
if (!get("SHOPIFY_PUBLIC_APP_CLIENT_ID")) set("SHOPIFY_PUBLIC_APP_CLIENT_ID", "postbus-staging-public-app");
if (!get("SHOPIFY_PUBLIC_APP_CLIENT_SECRET")) set("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", TEST_PUBLIC);
if (!get("SHOPIFY_EMBEDDED_APP_ENABLED")) set("SHOPIFY_EMBEDDED_APP_ENABLED", "false");
set("SHOPIFY_MOCK_MODE", "true");
set("POSTBUS_NEXT_DIST_DIR", ".next-staging-e2e");

writeFileSync(file, text);
console.log(
  JSON.stringify({
    ok: true,
    shopifySecretPresent: Boolean(get("SHOPIFY_API_SECRET")),
    publicSecretPresent: Boolean(get("SHOPIFY_PUBLIC_APP_CLIENT_SECRET")),
    productionRef: false,
  })
);
