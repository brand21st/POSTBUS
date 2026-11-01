/**
 * Stage B gate. Does not provision, migrate, or deploy.
 * Does not load .env.local. Never prints secrets.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  PRODUCTION_COOLIFY_APPLICATION_UUID,
  PRODUCTION_SUPABASE_REF,
  assertHostedStagingProvisioningTarget,
  parseDotEnvFile,
} from "../../lib/env/staging-isolation.ts";

const file = process.argv[2] || ".env.staging.local";
if (!existsSync(file)) {
  console.error(`STOP: ${file} is missing. Refusing to treat production .env.local as staging.`);
  process.exit(1);
}

const vars = Object.fromEntries(parseDotEnvFile(readFileSync(file, "utf8")));
try {
  const identity = assertHostedStagingProvisioningTarget(vars);
  let appUrlHost = "invalid";
  try {
    appUrlHost = new URL(vars.NEXT_PUBLIC_APP_URL || "http://127.0.0.1").host;
  } catch {
    appUrlHost = "invalid";
  }
  let indiaPostUatHost = "missing";
  try {
    indiaPostUatHost = new URL(vars.INDIA_POST_UAT_BASE_URL || "").host;
  } catch {
    indiaPostUatHost = "missing";
  }
  console.log(
    JSON.stringify({
      ok: true,
      mode: "hosted-staging-gate",
      provision: false,
      projectRef: identity.projectRef || "non-supabase-host",
      productionRefDenied: PRODUCTION_SUPABASE_REF,
      productionCoolifyDenied: PRODUCTION_COOLIFY_APPLICATION_UUID,
      appUrlHost,
      indiaPostUatHost,
    })
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
