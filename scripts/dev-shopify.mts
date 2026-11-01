/**
 * Start Next against .env.shopify-local only.
 * Overlay values win over the parent process so Next will not keep production
 * NEXT_PUBLIC_SUPABASE_URL from .env.local. Missing overlay or production refs abort.
 * This is not remote-write authorization. Do not db push from this script.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseDotEnvFile } from "../lib/env/staging-isolation.ts";
import {
  SHOPIFY_DEV_PARENT_ENV_BLOCKLIST,
  assertShopifyDevRuntimeEnv,
} from "../lib/env/shopify-dev-isolation.ts";

const file = ".env.shopify-local";
if (!existsSync(file)) {
  console.error(
    "STOP: copy .env.shopify-local.example to .env.shopify-local with postbus-shopify-dev credentials. Refusing to start (no production fallback)."
  );
  process.exit(1);
}

const vars = Object.fromEntries(parseDotEnvFile(readFileSync(file, "utf8")));
vars.POSTBUS_SHOPIFY_DEV = "true";
if (!vars.JOB_RUNNER) vars.JOB_RUNNER = "none";

try {
  const identity = assertShopifyDevRuntimeEnv(vars);
  console.log(
    JSON.stringify({
      ok: true,
      mode: "shopify-cloud-dev",
      projectName: identity.projectName,
      projectRef: identity.projectRef,
      write: false,
      migrate: false,
    })
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const gateOnly = process.argv.includes("--gate");
if (gateOnly) {
  process.exit(0);
}

const childEnv: NodeJS.ProcessEnv = { ...process.env };
for (const key of SHOPIFY_DEV_PARENT_ENV_BLOCKLIST) {
  delete childEnv[key];
}
Object.assign(childEnv, vars, {
  POSTBUS_SHOPIFY_DEV: "true",
  JOB_RUNNER: "none",
});

const next = spawn("npx", ["next", "dev", "-p", vars.PORT || "3002"], {
  stdio: "inherit",
  env: childEnv,
  shell: true,
});
next.on("exit", (code) => process.exit(code ?? 1));
