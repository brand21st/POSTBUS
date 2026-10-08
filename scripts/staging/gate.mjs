import { CEPT_STUB_URL, DATABASE_URL, PGDATABASE, PGHOST, PGPORT } from "./paths.mjs";
import { assertIsolatedTarget } from "./assert-not-production.mjs";

export function printSafetyGate(extra = {}) {
  const info = {
    STAGING_HOST: PGHOST,
    STAGING_PORT: PGPORT,
    STAGING_DATABASE: PGDATABASE,
    ENVIRONMENT: "postbus-staging-local",
    PROVIDER_MODE: "STUB",
    PRODUCTION_PROJECT_REF: "(not used)",
    CEPT_STUB_URL,
    DATABASE_URL,
    ...extra,
  };
  for (const [k, v] of Object.entries(info)) console.log(`${k}=${v}`);
  if (PGHOST !== "127.0.0.1") throw new Error("STOP: host");
  if (String(PGPORT) !== "55432") throw new Error("STOP: port");
  if (PGDATABASE !== "postbus_staging") throw new Error("STOP: database");
  if (info.PROVIDER_MODE !== "STUB") throw new Error("STOP: provider");
  assertIsolatedTarget("database", DATABASE_URL);
  assertIsolatedTarget("stub", CEPT_STUB_URL);
  assertIsolatedTarget("host", PGHOST);
}
