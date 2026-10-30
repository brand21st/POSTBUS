import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261030120000_business_trial_policy.sql"),
  "utf8"
);

describe("business trial policy migration", () => {
  it("is idempotent and does not insert a second live subscription", () => {
    expect(sql).toContain("and s.trial_cohort is null");
    expect(sql).toContain("coalesce(s.trial_manual_override, false) = false");
    expect(sql).toContain("timestamptz '2026-11-01 00:00:00+05:30'");
    expect(sql).toContain("o.created_at + interval '7 days'");
    expect(sql).toContain("trial_days = 7");
    expect(sql).toContain("update public.subscriptions s");
    expect(sql).toContain("insert into public.subscriptions (");
    expect(sql).toContain("'rolling_7d'");
    expect(sql).toContain("'legacy_nov1'");
  });

  it("skips paid captured accounts", () => {
    expect(sql).toContain("p.status = 'CAPTURED'");
    expect(sql).toContain("s.razorpay_subscription_id is null");
  });
});
