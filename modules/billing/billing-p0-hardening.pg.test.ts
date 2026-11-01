import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { BASE_SCHEMA } from "@/modules/billing/__fixtures__/billing-schema";

/**
 * Runs the real migration SQL (supabase/migrations/20261101100000_billing_p0_hardening.sql)
 * against a minimal billing schema, so fulfillment, retry, renewal, and webhook
 * lease rules are verified in Postgres rather than in a JavaScript stand-in.
 */

const MIGRATION = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261101100000_billing_p0_hardening.sql"),
  "utf8"
);



const PRO = "00000000-0000-4000-8000-0000000000a2";
const STARTER = "00000000-0000-4000-8000-0000000000a1";
const ORG = "10000000-0000-4000-8000-000000000001";
const ORG_LEGACY = "10000000-0000-4000-8000-000000000002";
const ORG_DUP = "10000000-0000-4000-8000-000000000003";
const ORG_OTHER = "10000000-0000-4000-8000-000000000004";
const ORG_NOSUB = "10000000-0000-4000-8000-000000000005";
const ORG_RENEW = "10000000-0000-4000-8000-000000000006";

let db: PGlite;

type Result = Record<string, unknown>;

async function fulfill(args: {
  order: string;
  payment: string;
  amount: number;
  org?: string | null;
  currency?: string;
  reason?: string;
}): Promise<Result> {
  const res = await db.query<{ r: Result }>(
    `select public.fulfill_captured_subscription_purchase($1, $2, $3, $4, null, $5, 'test', $6) as r`,
    [args.order, args.payment, args.amount, args.currency ?? "INR", args.org ?? null, args.reason ?? "checkout_verified"]
  );
  return res.rows[0].r;
}

async function sub(org: string) {
  const res = await db.query<{
    id: string;
    status: string;
    plan_id: string;
    amount_paise: string;
    current_period_end: string;
  }>(
    "select id, status, plan_id, amount_paise::text, current_period_end::text from subscriptions where organization_id = $1 order by created_at desc limit 1",
    [org]
  );
  return res.rows[0];
}

async function intent(org: string, order: string, overrides: Record<string, unknown> = {}) {
  const row = { amount: 149900, plan: PRO, subscription: null as string | null, status: "PENDING", ...overrides };
  await db.query(
    `insert into payments (organization_id, subscription_id, plan_id, amount_paise, status, razorpay_order_id, billing_cycle)
     values ($1, $2, $3, $4, $5, $6, 'monthly')`,
    [org, row.subscription, row.plan, row.amount, row.status, order]
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await db.query("insert into plans values ($1, 'starter', 49900, 479040, 500), ($2, 'pro', 149900, 1439040, 3000)", [
    STARTER,
    PRO,
  ]);
  for (const org of [ORG, ORG_LEGACY, ORG_DUP, ORG_OTHER, ORG_NOSUB, ORG_RENEW]) {
    await db.query("insert into organizations (id) values ($1)", [org]);
  }
  // Trial subscriptions.
  for (const org of [ORG, ORG_LEGACY, ORG_DUP, ORG_OTHER]) {
    await db.query(
      `insert into subscriptions (organization_id, plan_id, status, current_period_start, current_period_end, trial_end)
       values ($1, $2, 'TRIAL', now() - interval '2 days', now() + interval '5 days', now() + interval '5 days')`,
      [org, PRO]
    );
  }
  // Legacy data written by the old payment.failed handler: PENDING intent plus a FAILED row for the same order.
  await intent(ORG_LEGACY, "order_legacy");
  await db.query(
    `insert into payments (organization_id, plan_id, amount_paise, status, razorpay_order_id, razorpay_payment_id, failure_reason)
     values ($1, $2, 149900, 'FAILED', 'order_legacy', 'pay_legacy_failed', 'card declined')`,
    [ORG_LEGACY, PRO]
  );
  // Two real intents for one order: must stay ambiguous and block the unique index.
  await intent(ORG_DUP, "order_dup");
  await intent(ORG_DUP, "order_dup");

  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db?.close();
});

describe("migration backfill and guards", () => {
  it("copies legacy FAILED rows into payment_attempts without touching payments", async () => {
    const attempts = await db.query<{ status: string; source: string; purchase_id: string | null }>(
      "select status, source, purchase_id from payment_attempts where razorpay_payment_id = 'pay_legacy_failed'"
    );
    expect(attempts.rows).toHaveLength(1);
    expect(attempts.rows[0]).toMatchObject({ status: "FAILED", source: "legacy_backfill" });
    expect(attempts.rows[0].purchase_id).not.toBeNull();
    const failedRow = await db.query("select 1 from payments where razorpay_payment_id = 'pay_legacy_failed' and status = 'FAILED'");
    expect(failedRow.rows).toHaveLength(1);
  });

  it("does not create the one-intent-per-order index while duplicate intents exist", async () => {
    const index = await db.query("select 1 from pg_indexes where indexname = 'payments_subscription_intent_order_uidx'");
    expect(index.rows).toHaveLength(0);
  });

  it("is idempotent when re-applied", async () => {
    await db.exec(MIGRATION);
    const attempts = await db.query("select 1 from payment_attempts where razorpay_payment_id = 'pay_legacy_failed'");
    expect(attempts.rows).toHaveLength(1);
  });
});

describe("fulfill_captured_subscription_purchase", () => {
  it("activates exactly once after FAILED, FAILED, then CAPTURED on the same order (F-06)", async () => {
    await intent(ORG, "order_retry");
    // Attempts 1 and 2 fail: recorded as attempts, the intent stays PENDING.
    for (const id of ["pay_fail_1", "pay_fail_2"]) {
      await db.query(
        "insert into payment_attempts (organization_id, razorpay_order_id, razorpay_payment_id, status) values ($1, 'order_retry', $2, 'FAILED')",
        [ORG, id]
      );
    }
    const before = await sub(ORG);
    expect(before.status).toBe("TRIAL");

    const first = await fulfill({ order: "order_retry", payment: "pay_ok_3", amount: 149900, org: ORG });
    expect(first).toMatchObject({ handled: true, granted: true });
    const second = await fulfill({ order: "order_retry", payment: "pay_ok_3", amount: 149900, org: ORG, reason: "payment.captured" });
    expect(second).toMatchObject({ handled: true, duplicate: true });

    const after = await sub(ORG);
    expect(after.status).toBe("ACTIVE");
    expect(after.plan_id).toBe(PRO);
    const days = (new Date(after.current_period_end).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    const history = await db.query("select 1 from subscription_history where subscription_id = $1 and to_status = 'ACTIVE'", [
      after.id,
    ]);
    expect(history.rows).toHaveLength(1);
    const payments = await db.query<{ status: string }>("select status from payments where razorpay_order_id = 'order_retry'");
    expect(payments.rows.map((row) => row.status)).toEqual(["CAPTURED"]);
    const attempts = await db.query<{ razorpay_payment_id: string; status: string }>(
      "select razorpay_payment_id, status from payment_attempts where razorpay_order_id = 'order_retry' order by razorpay_payment_id"
    );
    expect(attempts.rows).toEqual([
      { razorpay_payment_id: "pay_fail_1", status: "FAILED" },
      { razorpay_payment_id: "pay_fail_2", status: "FAILED" },
      { razorpay_payment_id: "pay_ok_3", status: "CAPTURED" },
    ]);
  });

  it("is not made ambiguous by a legacy FAILED payments row for the same order", async () => {
    const result = await fulfill({ order: "order_legacy", payment: "pay_legacy_ok", amount: 149900, org: ORG_LEGACY });
    expect(result).toMatchObject({ granted: true });
    expect((await sub(ORG_LEGACY)).status).toBe("ACTIVE");
  });

  it("fails closed on two real purchase intents for one order", async () => {
    const result = await fulfill({ order: "order_dup", payment: "pay_dup", amount: 149900, org: ORG_DUP });
    expect(result).toMatchObject({ handled: true, ambiguous: true });
    expect((await sub(ORG_DUP)).status).toBe("TRIAL");
  });

  it("rejects another organization's payment, wrong amount, and wrong currency", async () => {
    await intent(ORG_OTHER, "order_other");
    expect(await fulfill({ order: "order_other", payment: "pay_x", amount: 149900, org: ORG })).toMatchObject({ forbidden: true });
    expect(await fulfill({ order: "order_other", payment: "pay_x", amount: 100, org: ORG_OTHER })).toMatchObject({
      amountMismatch: true,
    });
    expect(
      await fulfill({ order: "order_other", payment: "pay_x", amount: 149900, org: ORG_OTHER, currency: "USD" })
    ).toMatchObject({ currencyMismatch: true });
    expect((await sub(ORG_OTHER)).status).toBe("TRIAL");
    const pending = await db.query("select 1 from payments where razorpay_order_id = 'order_other' and status = 'PENDING'");
    expect(pending.rows).toHaveLength(1);
  });

  it("refuses a different payment id on an already captured order (replay)", async () => {
    const replay = await fulfill({ order: "order_retry", payment: "pay_someone_else", amount: 149900, org: ORG });
    expect(replay).toMatchObject({ forbidden: true });
  });

  it("returns notFound for an unknown order and never activates", async () => {
    expect(await fulfill({ order: "order_missing", payment: "pay_missing", amount: 149900, org: ORG })).toMatchObject({
      handled: false,
      notFound: true,
    });
  });

  it("creates the subscription row for a workspace that never had one", async () => {
    await intent(ORG_NOSUB, "order_nosub", { plan: STARTER, amount: 49900 });
    const result = await fulfill({ order: "order_nosub", payment: "pay_nosub", amount: 49900, org: ORG_NOSUB });
    expect(result).toMatchObject({ granted: true });
    const created = await sub(ORG_NOSUB);
    expect(created).toMatchObject({ status: "ACTIVE", plan_id: STARTER });
  });

  it("keeps unused paid days when a paid customer renews early, and never for trial time", async () => {
    await db.query(
      `insert into subscriptions (organization_id, plan_id, status, amount_paise, current_period_start, current_period_end)
       values ($1, $2, 'ACTIVE', 49900, now() - interval '20 days', now() + interval '10 days')`,
      [ORG_RENEW, STARTER]
    );
    const current = await sub(ORG_RENEW);
    await db.query(
      `insert into payments (organization_id, subscription_id, plan_id, amount_paise, status, razorpay_order_id, razorpay_payment_id, paid_at)
       values ($1, $2, $3, 49900, 'CAPTURED', 'order_paid_before', 'pay_paid_before', now() - interval '20 days')`,
      [ORG_RENEW, current.id, STARTER]
    );
    await intent(ORG_RENEW, "order_renew", { plan: STARTER, amount: 49900 });
    expect(await fulfill({ order: "order_renew", payment: "pay_renew", amount: 49900, org: ORG_RENEW })).toMatchObject({
      granted: true,
    });
    const renewed = await sub(ORG_RENEW);
    const days = (new Date(renewed.current_period_end).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(37);
    expect(days).toBeLessThan(42);
    // ORG_LEGACY converted from a trial with 5 days left: no carry-over.
    const fromTrial = await sub(ORG_LEGACY);
    const trialDays = (new Date(fromTrial.current_period_end).getTime() - Date.now()) / 86_400_000;
    expect(trialDays).toBeLessThan(32);
  });

  it("serializes concurrent fulfillment of the same capture to one activation", async () => {
    await db.query("update subscriptions set status = 'EXPIRED' where organization_id = $1", [ORG_OTHER]);
    await db.query("delete from payments where razorpay_order_id = 'order_other'");
    await intent(ORG_OTHER, "order_concurrent");
    const results = await Promise.all([
      fulfill({ order: "order_concurrent", payment: "pay_c", amount: 149900, org: ORG_OTHER }),
      fulfill({ order: "order_concurrent", payment: "pay_c", amount: 149900, org: ORG_OTHER, reason: "payment.captured" }),
    ]);
    expect(results.filter((row) => row.granted)).toHaveLength(1);
    expect(results.filter((row) => row.duplicate)).toHaveLength(1);
    const history = await db.query(
      "select 1 from subscription_history where organization_id = $1 and to_status = 'ACTIVE'",
      [ORG_OTHER]
    );
    expect(history.rows).toHaveLength(1);
  });
});

describe("claim_razorpay_webhook_event (F-07)", () => {
  async function claim(eventId: string) {
    const res = await db.query<{ r: Result }>("select public.claim_razorpay_webhook_event($1, 300) as r", [eventId]);
    return res.rows[0].r;
  }

  it("lets Razorpay's retry reprocess an event whose first attempt failed", async () => {
    await db.query("insert into razorpay_webhook_events (event_id, event) values ('evt_retry', 'payment.captured')");
    const first = await claim("evt_retry");
    expect(first.state).toBe("claimed");
    // A concurrent delivery while the lease is live must not process it twice.
    expect((await claim("evt_retry")).state).toBe("busy");
    // First attempt fails: lease released.
    await db.query(
      "update razorpay_webhook_events set status = 'failed', processing_until = null where event_id = 'evt_retry' and processing_lease = $1",
      [first.lease]
    );
    const retry = await claim("evt_retry");
    expect(retry.state).toBe("claimed");
    expect(retry.attempts).toBe(2);
    await db.query(
      "update razorpay_webhook_events set status = 'processed', processing_until = null where event_id = 'evt_retry' and processing_lease = $1",
      [retry.lease]
    );
    expect((await claim("evt_retry")).state).toBe("complete");
  });

  it("reclaims an abandoned lease after it expires", async () => {
    await db.query(
      "insert into razorpay_webhook_events (event_id, event, processing_until) values ('evt_abandoned', 'payment.captured', now() - interval '1 minute')"
    );
    expect((await claim("evt_abandoned")).state).toBe("claimed");
  });

  it("reports missing events", async () => {
    expect((await claim("evt_never_stored")).state).toBe("missing");
  });
});

describe("regression evidence: previous fulfillment RPC", () => {
  it("returns ambiguous for a retried order that has a FAILED attempt row (bug F-06)", async () => {
    const old = new PGlite();
    try {
      await old.exec(BASE_SCHEMA);
      await old.exec(
        readFileSync(
          path.join(process.cwd(), "supabase/migrations/20261030153000_fulfill_expired_subscription_purchase.sql"),
          "utf8"
        )
      );
      await old.query("insert into plans values ($1, 'pro', 149900, 1439040, 3000)", [PRO]);
      await old.query("insert into organizations (id) values ($1)", [ORG]);
      await old.query(
        "insert into subscriptions (organization_id, plan_id, status, current_period_end) values ($1, $2, 'TRIAL', now() + interval '5 days')",
        [ORG, PRO]
      );
      await old.query(
        "insert into payments (organization_id, plan_id, amount_paise, status, razorpay_order_id, billing_cycle) values ($1, $2, 149900, 'PENDING', 'order_r', 'monthly')",
        [ORG, PRO]
      );
      await old.query(
        "insert into payments (organization_id, plan_id, amount_paise, status, razorpay_order_id, razorpay_payment_id) values ($1, $2, 149900, 'FAILED', 'order_r', 'pay_f')",
        [ORG, PRO]
      );
      const res = await old.query<{ r: Result }>(
        "select public.fulfill_captured_subscription_purchase('order_r', 'pay_ok', 149900, 'INR', null, $1, 'test', 'checkout_verified') as r",
        [ORG]
      );
      expect(res.rows[0].r).toMatchObject({ ambiguous: true });
    } finally {
      await old.close();
    }
  });
});
