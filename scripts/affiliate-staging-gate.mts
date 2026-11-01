/** Fail closed before any affiliate migration against a remote database. */
import { assertAffiliateStagingTarget } from "../modules/affiliates/tax-evidence.ts";

const result = assertAffiliateStagingTarget({
  projectRef: process.env.SUPABASE_PROJECT_REF,
  productionRefs: (process.env.POSTBUS_PRODUCTION_SUPABASE_REFS || "hgacoeoovjxkzfbesmvl").split(","),
  approvedStagingRef: process.env.AFFILIATE_STAGING_PROJECT_REF,
  databaseUrl: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  environmentName: process.env.POSTBUS_AFFILIATE_STAGING_ENV,
  writeAuthorized: process.env.AFFILIATE_STAGING_WRITE_AUTHORIZATION,
});
console.log(JSON.stringify({ ok: result.ok, reason: result.reason }));
process.exit(result.ok ? 0 : 1);
