/**
 * Copy local `supabase status -o env` into .env.staging.local.
 * Does not print secrets. Refuses production project ref.
 */
import { readFileSync, writeFileSync } from "node:fs";

const PRODUCTION_REF = "hgacoeoovjxkzfbesmvl";
const status = Object.fromEntries(
  readFileSync(".staging/supabase-local.env", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const anon = status.ANON_KEY || status.SUPABASE_ANON_KEY || "";
const service = status.SERVICE_ROLE_KEY || status.SUPABASE_SERVICE_ROLE_KEY || "";
const url = status.API_URL || "http://127.0.0.1:54321";
const blob = `${anon} ${service} ${url}`.toLowerCase();
if (!anon || !service) {
  console.error("STOP: local status file missing keys");
  process.exit(1);
}
if (blob.includes(PRODUCTION_REF)) {
  console.error("STOP: production project ref found in local status");
  process.exit(1);
}

function jwtClaim(jwt, name) {
  try {
    const payload = jwt.split(".")[1];
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return String(json[name] ?? "");
  } catch {
    return "";
  }
}

const ref = jwtClaim(anon, "ref");
console.log(
  JSON.stringify({
    url,
    anonLen: anon.length,
    serviceLen: service.length,
    jwtRef: ref || "(none)",
    productionRef: ref.includes(PRODUCTION_REF),
  })
);

let text = readFileSync(".env.staging.local", "utf8");
function set(key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, `${key}=${value}`);
  else text += `\n${key}=${value}\n`;
}
set("NEXT_PUBLIC_SUPABASE_URL", url);
set("NEXT_PUBLIC_SUPABASE_ANON_KEY", anon);
set("SUPABASE_SERVICE_ROLE_KEY", service);
set("STAGING_DATABASE_URL", "postgresql://postgres@127.0.0.1:54332/postgres");
set("STAGING_NAME", "postbus-staging-local-docker");
writeFileSync(".env.staging.local", text);
