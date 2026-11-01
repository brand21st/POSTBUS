/**
 * Start Next against .env.staging.local only.
 * Does not load production .env.local as the selected target: values from the
 * staging file are injected into the child env first so Next will not override them.
 * Missing or production targets abort. This is not remote-write authorization.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { assertStagingRuntimeEnv, parseDotEnvFile } from "../lib/env/staging-isolation.ts";

const file = ".env.staging.local";
if (!existsSync(file)) {
  console.error("STOP: copy .env.staging.example to .env.staging.local with an isolated non-production project. Refusing to start (no production fallback).");
  process.exit(1);
}
const vars = Object.fromEntries(parseDotEnvFile(readFileSync(file, "utf8")));
try {
  const identity = assertStagingRuntimeEnv(vars);
  console.log(JSON.stringify({ ok: true, mode: "staging-runtime", projectRef: identity.projectRef, write: false }));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

/**
 * Next.js loads .env.local for any variable not already in the process env.
 * Keys present only in production .env.local (Shopify public app, encryption,
 * PostHog, cron, etc.) must be blanked or they would leak into staging.
 */
const productionLocalKeys = existsSync(".env.local")
  ? [...parseDotEnvFile(readFileSync(".env.local", "utf8")).keys()]
  : [];
const childEnv = { ...process.env, ...vars, POSTBUS_ENV: "staging" };
for (const key of productionLocalKeys) {
  if (!(key in vars)) {
    childEnv[key] = "";
  }
}
for (const key of [
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "DIRECT_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "COOLIFY_API_TOKEN",
  "COOLIFY_APPLICATION_UUID",
]) {
  if (!(key in vars)) childEnv[key] = "";
}

childEnv.NODE_ENV = "development";
if (!("POSTBUS_NEXT_DIST_DIR" in vars)) {
  childEnv.POSTBUS_NEXT_DIST_DIR = ".next-staging";
}

const next = spawn("npx", ["next", "dev", "-H", "127.0.0.1", "-p", vars.PORT || "3001"], {
  stdio: "inherit",
  env: childEnv,
  shell: true,
});
next.on("exit", (code) => process.exit(code ?? 1));
