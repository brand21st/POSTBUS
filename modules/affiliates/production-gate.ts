/** Fail-closed production affiliate migration gate. Independent of the staging gate. */

export const PRODUCTION_AFFILIATE_PROJECT_REF = "hgacoeoovjxkzfbesmvl";

export const PRODUCTION_AFFILIATE_MIGRATIONS = [
  { file: "20261017120000_affiliate_program.sql", sha256: "762ef309bf474345fa009204738766cb7cbdcf7916cd83d6858efa7ffced4709" },
  { file: "20261017121000_affiliate_operations.sql", sha256: "68949da35ae639c995f347ff48e5378ee34dbcb4af7485fc6342404542aa3907" },
  { file: "20261017122000_affiliate_webhook_leases.sql", sha256: "4b223f55fb3557c5d1054c8ab77d625fad82e670b1ce55ab50e02e747e7db3c5" },
  { file: "20261017123000_affiliate_reporting.sql", sha256: "abc872d6567171cbed80c22f9a88ca6b2a89d836337799da2a5ca24ec0e05311" },
  { file: "20261017124000_affiliate_reconciliation.sql", sha256: "ec8f87e0524a5050ad488c07171388ba33f89d0c3b0bc5abbf9f403d0277b7ad" },
  { file: "20261017125000_affiliate_partner_portal.sql", sha256: "a0d65c2f0006f01db5e4bc7d8db9488b509007e0e0165357ed90f14276c63860" },
  { file: "20261017130000_subscription_tax_policy.sql", sha256: "44c56fab09ea4f7562bc62593f5e307ed49b7a925492f34e04e2c4f7c42aebe4" },
  { file: "20261017140000_subscription_tax_invoices.sql", sha256: "00e7c8e65b06c2431bbb4d75ec1d02c48ba29ca04a493d65cf6e998bf58d9d94" },
] as const;

export const PRODUCTION_AFFILIATE_SCOPE = PRODUCTION_AFFILIATE_MIGRATIONS.map((row) => row.file).join(",");
export const PRODUCTION_AFFILIATE_CHECKSUMS = PRODUCTION_AFFILIATE_MIGRATIONS.map((row) => row.sha256).join(":");

/** Exact write token. Generic APPROVED=true is rejected. */
export const PRODUCTION_AFFILIATE_WRITE_TOKEN = "AFFILIATE_PRODUCTION_MIGRATE_APPROVED_hgacoeoovjxkzfbesmvl";
export const PRODUCTION_AFFILIATE_BACKUP_TOKEN = "OPERATOR_CONFIRMED_PITR_OR_BACKUP";

function hostLooksLikeApprovedProduction(value?: string | null) {
  const blob = (value ?? "").trim().toLowerCase();
  if (!blob) return false;
  return blob.includes(`${PRODUCTION_AFFILIATE_PROJECT_REF}.supabase.co`);
}

export function assertAffiliateProductionTarget(input: {
  projectRef?: string | null;
  approvedProjectRef?: string | null;
  supabaseUrl?: string | null;
  databaseUrl?: string | null;
  writeAuthorized?: string | null;
  migrationScope?: string | null;
  checksums?: string | null;
  backupConfirmed?: string | null;
  operator?: string | null;
  windowAuthorized?: string | null;
}) {
  const projectRef = (input.projectRef ?? "").trim();
  const approved = (input.approvedProjectRef ?? "").trim();
  if (!projectRef) return { ok: false as const, reason: "missing_project_ref" };
  if (projectRef !== PRODUCTION_AFFILIATE_PROJECT_REF || approved !== PRODUCTION_AFFILIATE_PROJECT_REF) {
    return { ok: false as const, reason: "project_ref_mismatch" };
  }
  if (!hostLooksLikeApprovedProduction(input.supabaseUrl) && !hostLooksLikeApprovedProduction(input.databaseUrl)) {
    return { ok: false as const, reason: "hostname_not_production_project" };
  }
  if ((input.writeAuthorized ?? "").trim() === "true" || (input.writeAuthorized ?? "").trim() === "APPROVED") {
    return { ok: false as const, reason: "generic_approval_rejected" };
  }
  if ((input.writeAuthorized ?? "").trim() !== PRODUCTION_AFFILIATE_WRITE_TOKEN) {
    return { ok: false as const, reason: "production_write_not_authorized" };
  }
  if ((input.migrationScope ?? "").trim() !== PRODUCTION_AFFILIATE_SCOPE) {
    return { ok: false as const, reason: "migration_scope_mismatch" };
  }
  if ((input.checksums ?? "").trim().toLowerCase() !== PRODUCTION_AFFILIATE_CHECKSUMS) {
    return { ok: false as const, reason: "checksum_mismatch" };
  }
  if ((input.backupConfirmed ?? "").trim() !== PRODUCTION_AFFILIATE_BACKUP_TOKEN) {
    return { ok: false as const, reason: "backup_not_confirmed" };
  }
  if (!(input.operator ?? "").trim()) return { ok: false as const, reason: "operator_missing" };
  if ((input.windowAuthorized ?? "").trim() !== "AFFILIATE_PRODUCTION_WINDOW_OPEN") {
    return { ok: false as const, reason: "deployment_window_not_authorized" };
  }
  return { ok: true as const, reason: "approved_production_checkpoint" };
}
