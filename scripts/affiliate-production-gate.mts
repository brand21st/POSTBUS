/** Evaluate the production affiliate migration gate. Does not apply SQL. */
import { assertAffiliateProductionTarget } from "../modules/affiliates/production-gate.ts";

const result = assertAffiliateProductionTarget({
  projectRef: process.env.SUPABASE_PROJECT_REF,
  approvedProjectRef: process.env.AFFILIATE_PRODUCTION_PROJECT_REF,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  databaseUrl: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL,
  writeAuthorized: process.env.AFFILIATE_PRODUCTION_WRITE_AUTHORIZATION,
  migrationScope: process.env.AFFILIATE_PRODUCTION_MIGRATION_SCOPE,
  checksums: process.env.AFFILIATE_PRODUCTION_CHECKSUMS,
  backupConfirmed: process.env.AFFILIATE_PRODUCTION_BACKUP_CONFIRMED,
  operator: process.env.AFFILIATE_PRODUCTION_OPERATOR,
  windowAuthorized: process.env.AFFILIATE_PRODUCTION_WINDOW,
});
console.log(JSON.stringify({ ok: result.ok, reason: result.reason }));
process.exit(result.ok ? 0 : 1);
