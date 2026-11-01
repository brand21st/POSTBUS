import { describe, expect, it } from "vitest";
import {
  PRODUCTION_AFFILIATE_CHECKSUMS,
  PRODUCTION_AFFILIATE_PROJECT_REF,
  PRODUCTION_AFFILIATE_SCOPE,
  PRODUCTION_AFFILIATE_BACKUP_TOKEN,
  PRODUCTION_AFFILIATE_WRITE_TOKEN,
  assertAffiliateProductionTarget,
} from "./production-gate";

const valid = {
  projectRef: PRODUCTION_AFFILIATE_PROJECT_REF,
  approvedProjectRef: PRODUCTION_AFFILIATE_PROJECT_REF,
  supabaseUrl: `https://${PRODUCTION_AFFILIATE_PROJECT_REF}.supabase.co`,
  writeAuthorized: PRODUCTION_AFFILIATE_WRITE_TOKEN,
  migrationScope: PRODUCTION_AFFILIATE_SCOPE,
  checksums: PRODUCTION_AFFILIATE_CHECKSUMS,
  backupConfirmed: PRODUCTION_AFFILIATE_BACKUP_TOKEN,
  operator: "operator@postbus.in",
  windowAuthorized: "AFFILIATE_PRODUCTION_WINDOW_OPEN",
};

describe("affiliate production migration gate", () => {
  it("rejects missing or non-production refs and generic APPROVED=true", () => {
    expect(assertAffiliateProductionTarget({}).reason).toBe("missing_project_ref");
    expect(assertAffiliateProductionTarget({ ...valid, projectRef: "other" }).reason).toBe("project_ref_mismatch");
    expect(assertAffiliateProductionTarget({ ...valid, supabaseUrl: "https://other.supabase.co", databaseUrl: "" }).reason).toBe("hostname_not_production_project");
    expect(assertAffiliateProductionTarget({ ...valid, writeAuthorized: "true" }).reason).toBe("generic_approval_rejected");
    expect(assertAffiliateProductionTarget({ ...valid, writeAuthorized: "APPROVED" }).reason).toBe("generic_approval_rejected");
    expect(assertAffiliateProductionTarget({ ...valid, writeAuthorized: "AFFILIATE_STAGING_WRITE_APPROVED" }).reason).toBe("production_write_not_authorized");
  });

  it("rejects scope, checksum, backup, operator, and window gaps", () => {
    expect(assertAffiliateProductionTarget({ ...valid, migrationScope: "extra.sql" }).reason).toBe("migration_scope_mismatch");
    expect(assertAffiliateProductionTarget({ ...valid, checksums: "abc" }).reason).toBe("checksum_mismatch");
    expect(assertAffiliateProductionTarget({ ...valid, backupConfirmed: "yes" }).reason).toBe("backup_not_confirmed");
    expect(assertAffiliateProductionTarget({ ...valid, operator: "  " }).reason).toBe("operator_missing");
    expect(assertAffiliateProductionTarget({ ...valid, windowAuthorized: "" }).reason).toBe("deployment_window_not_authorized");
  });

  it("passes only the exact production checkpoint", () => {
    expect(assertAffiliateProductionTarget(valid)).toEqual({ ok: true, reason: "approved_production_checkpoint" });
  });
});
