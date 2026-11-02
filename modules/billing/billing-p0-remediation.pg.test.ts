import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { BASE_SCHEMA } from "@/modules/billing/__fixtures__/billing-schema";

/**
 * Exercises supabase/remediation/billing_p0_remediation.sql and its revert script
 * against seeded rows that mirror the production cases found in the audit.
 * The scripts end without COMMIT; the test strips BEGIN so statements apply here.
 */

function script(name: string) {
  return readFileSync(path.join(process.cwd(), "supabase/remediation", name), "utf8").replace(/^begin;$/m, "");
}

const PRO = "00000000-0000-4000-8000-0000000000a2";
const UNPAID_ACTIVE = "661ff3ca-d3d5-4051-a845-9243f0f9dc49";
const ORG_UNPAID = "20000000-0000-4000-8000-000000000001";
const ORG_OCT28 = "20000000-0000-4000-8000-000000000002";
const ORG_OVERRIDE = "20000000-0000-4000-8000-000000000003";
const ORG_PAID = "20000000-0000-4000-8000-000000000004";
const ORG_NOV1 = "20000000-0000-4000-8000-000000000005";
const ORG_PAID_TRIAL = "20000000-0000-4000-8000-000000000006";

let db: PGlite;

async function subOf(org: string) {
  const res = await db.query<{ status: string; trial_end: string | null; trial_cohort: string | null }>(
    "select status, trial_end::text, trial_cohort from subscriptions where organization_id = $1",
    [org]
  );
  return res.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await db.exec(readFileSync(path.join(process.cwd(), "supabase/migrations/20261101100000_billing_p0_hardening.sql"), "utf8"));
  await db.query("insert into plans values ($1, 'pro', 149900, 1439040, 3000)", [PRO]);
  const orgs: Array<[string, string]> = [
    [ORG_UNPAID, "2026-10-20T09:52:44Z"],
    [ORG_OCT28, "2026-10-28T06:00:00Z"],
    [ORG_OVERRIDE, "2026-10-29T06:00:00Z"],
    [ORG_PAID, "2026-10-08T19:50:02Z"],
    [ORG_NOV1, "2026-10-31T18:30:00Z"],
    [ORG_PAID_TRIAL, "2026-10-30T06:00:00Z"],
  ];
  for (const [id, created] of orgs) await db.query("insert into organizations (id, created_at) values ($1, $2)", [id, created]);
  await db.query(
    `insert into subscriptions (id, organization_id, plan_id, status, amount_paise, current_period_end, trial_cohort)
     values ($1, $2, $3, 'ACTIVE', 350000, '2026-10-31T18:30:00Z', 'legacy_nov1')`,
    [UNPAID_ACTIVE, ORG_UNPAID, PRO]
  );
  const rolling = (org: string, end: string, override = false) =>
    db.query(
      `insert into subscriptions (organization_id, plan_id, status, trial_end, current_period_end, expires_at, renews_at, trial_cohort, trial_manual_override)
       values ($1, $2, 'TRIAL', $3, $3, $3, $3, 'rolling_7d', $4)`,
      [org, PRO, end, override]
    );
  await rolling(ORG_OCT28, "2026-11-04T06:00:00Z");
  await rolling(ORG_OVERRIDE, "2026-11-06T18:30:00Z", true);
  await rolling(ORG_NOV1, "2026-11-07T18:30:00Z");
  await rolling(ORG_PAID_TRIAL, "2026-11-06T06:00:00Z");
  await db.query(
    "insert into payments (organization_id, plan_id, amount_paise, status, razorpay_order_id, razorpay_payment_id) values ($1, $2, 149900, 'CAPTURED', 'order_x', 'pay_x')",
    [ORG_PAID_TRIAL, PRO]
  );
  await db.query(
    `insert into subscriptions (organization_id, plan_id, status, amount_paise, current_period_end, trial_cohort)
     values ($1, $2, 'ACTIVE', 49900, '2026-11-30T10:54:11Z', 'legacy_nov1')`,
    [ORG_PAID, PRO]
  );
  await db.query(
    "insert into payments (organization_id, plan_id, amount_paise, status, razorpay_order_id, razorpay_payment_id) values ($1, $2, 49900, 'CAPTURED', 'order_p', 'pay_p')",
    [ORG_PAID, PRO]
  );
});

afterAll(async () => {
  await db?.close();
});

describe("billing_p0_remediation.sql", () => {
  it("reverts only the unpaid activation and applies the Nov 1 policy to the Oct 27-31 cohort", async () => {
    await db.exec(script("billing_p0_remediation.sql"));
    expect((await subOf(ORG_UNPAID)).status).toBe("EXPIRED");
    const oct28 = await subOf(ORG_OCT28);
    expect(oct28.trial_cohort).toBe("legacy_nov1");
    expect(new Date(String(oct28.trial_end)).toISOString()).toBe("2026-10-31T18:30:00.000Z");
    // Untouched: admin override, paid customer, Nov 1 signup, org with a captured payment.
    expect((await subOf(ORG_OVERRIDE)).trial_cohort).toBe("rolling_7d");
    expect((await subOf(ORG_PAID)).status).toBe("ACTIVE");
    expect((await subOf(ORG_NOV1)).trial_cohort).toBe("rolling_7d");
    expect((await subOf(ORG_PAID_TRIAL)).trial_cohort).toBe("rolling_7d");
    const log = await db.query<{ section: string; n: number }>(
      "select section, count(*)::int as n from billing_remediation_log group by section order by section"
    );
    expect(log.rows).toEqual([
      { section: "A_unpaid_activation", n: 1 },
      { section: "C_nov1_policy", n: 1 },
    ]);
    const history = await db.query("select 1 from subscription_history where reason like 'remediation_%'");
    expect(history.rows).toHaveLength(2);
  });

  it("refuses to apply the same batch twice", async () => {
    await expect(db.exec(script("billing_p0_remediation.sql"))).rejects.toThrow(/already applied/);
  });

  it("restores the original rows with the revert script", async () => {
    await db.exec("rollback;").catch(() => undefined);
    await db.exec(script("billing_p0_remediation_revert.sql"));
    expect((await subOf(ORG_UNPAID)).status).toBe("ACTIVE");
    const oct28 = await subOf(ORG_OCT28);
    expect(oct28.trial_cohort).toBe("rolling_7d");
    expect(new Date(String(oct28.trial_end)).toISOString()).toBe("2026-11-04T06:00:00.000Z");
    const open = await db.query("select 1 from billing_remediation_log where reverted_at is null");
    expect(open.rows).toHaveLength(0);
  });
});
