import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/modules/razorpay/config", () => ({
  isBillingConfiguredAsync: async () => false,
}));

import { BILLING_EXPIRING_NOTICES_ENABLED, runBillingSweep } from "@/modules/billing/cron";

function sweepDb(
  rows: Array<Record<string, unknown>>,
  notices: Array<Record<string, unknown>> = [],
  hooks: { beforeUpdate?: (cond: Record<string, unknown>) => void } = {}
) {
  const history: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let lteEnd: string | undefined;
      let gteEnd: string | undefined;
      const matchesRow = (row: Record<string, unknown>) => {
        const statuses = filters.status as string[] | undefined;
        const statusEq = typeof filters.status === "string" ? filters.status : undefined;
        if (statuses && !statuses.includes(String(row.status))) return false;
        if (statusEq && row.status !== statusEq) return false;
        if (lteEnd && String(row.current_period_end) > lteEnd) return false;
        if (gteEnd && String(row.current_period_end) < gteEnd) return false;
        return true;
      };
      const query: Record<string, unknown> = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return query;
        },
        in(column: string, value: unknown) {
          filters[column] = value;
          return query;
        },
        lte(column: string, value: unknown) {
          if (column === "current_period_end") lteEnd = String(value);
          return query;
        },
        gte(column: string, value: unknown) {
          if (column === "current_period_end") gteEnd = String(value);
          return query;
        },
        not() {
          return query;
        },
        limit() {
          return query;
        },
        then(resolve: (value: unknown) => void) {
          if (table === "notifications") {
            resolve({ data: notices, error: null });
            return;
          }
          if (table !== "subscriptions") {
            resolve({ data: [], error: null });
            return;
          }
          resolve({ data: rows.filter(matchesRow), error: null });
        },
        update(patch: Record<string, unknown>) {
          const cond: Record<string, unknown> = {};
          let updateLteEnd: string | undefined;
          const chain: Record<string, unknown> = {
            eq(column: string, value: unknown) {
              cond[column] = value;
              return chain;
            },
            lte(column: string, value: unknown) {
              if (column === "current_period_end") updateLteEnd = String(value);
              return chain;
            },
            select() {
              return chain;
            },
            then(resolve: (value: unknown) => void) {
              hooks.beforeUpdate?.(cond);
              const row = rows.find((item) => {
                if (!Object.entries(cond).every(([column, value]) => item[column] === value)) return false;
                if (updateLteEnd && String(item.current_period_end) > updateLteEnd) return false;
                return true;
              });
              if (!row) {
                resolve({ data: [], error: null });
                return;
              }
              Object.assign(row, patch);
              resolve({ data: [{ id: row.id }], error: null });
            },
          };
          return chain;
        },
        insert: async (row: Record<string, unknown>) => {
          if (table === "notifications") notices.push(row);
          else history.push(row);
          return { error: null };
        },
      };
      return query;
    },
  };
  return { supabase, rows, history, notices };
}

const ended = "2026-10-20T00:00:00.000Z";
const live = "2026-11-10T00:00:00.000Z";
const trialRow = (id: string, org: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: org,
  status: "TRIAL",
  cancel_at_period_end: false,
  current_period_end: ended,
  razorpay_subscription_id: null,
  ...extra,
});

describe("runBillingSweep", () => {
  it("expires ended trials but does not expire an uncanceled paid ACTIVE period", async () => {
    const db = sweepDb([
      trialRow("trial-1", "org-1"),
      {
        id: "paid-1",
        organization_id: "org-2",
        status: "ACTIVE",
        cancel_at_period_end: false,
        current_period_end: ended,
        razorpay_subscription_id: "sub_rzp",
      },
    ]);
    const first = await runBillingSweep(db.supabase as never);
    const second = await runBillingSweep(db.supabase as never);
    expect(first.expired).toBe(1);
    expect(second.expired).toBe(0);
    expect(db.rows[0]?.status).toBe("EXPIRED");
    expect(db.rows[1]?.status).toBe("ACTIVE");
    expect(db.history).toHaveLength(1);
  });

  it("leaves a historical unpaid ACTIVE Business row unchanged", async () => {
    const db = sweepDb([
      {
        id: "unpaid-active",
        organization_id: "org-unpaid",
        status: "ACTIVE",
        cancel_at_period_end: false,
        current_period_end: "2026-10-31T18:30:00.000Z",
        razorpay_subscription_id: null,
      },
    ]);
    const result = await runBillingSweep(db.supabase as never);
    expect(result.expired).toBe(0);
    expect(db.rows[0]?.status).toBe("ACTIVE");
    expect(db.history).toHaveLength(0);
  });

  it("expires a legacy November 1 trial at the cutoff and not one second before", async () => {
    const cutoff = "2026-10-31T18:30:00.000Z";
    const before = "2026-10-31T18:29:59.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(cutoff));
    const atCutoff = sweepDb([trialRow("legacy-1", "org-legacy", { current_period_end: cutoff })]);
    const expiredAt = await runBillingSweep(atCutoff.supabase as never);
    vi.setSystemTime(new Date(before));
    const stillLive = sweepDb([trialRow("legacy-2", "org-legacy-2", { current_period_end: cutoff })]);
    const beforeResult = await runBillingSweep(stillLive.supabase as never);
    vi.useRealTimers();
    expect(expiredAt.expired).toBe(1);
    expect(beforeResult.expired).toBe(0);
    expect(stillLive.rows[0]?.status).toBe("TRIAL");
  });

  it("expires a rolling seven-day trial only after its own timestamp", async () => {
    const rollingEnd = "2026-11-06T04:00:00.000Z";
    const db = sweepDb([trialRow("rolling-1", "org-rolling", { current_period_end: rollingEnd })]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000+05:30"));
    const nov1 = await runBillingSweep(db.supabase as never);
    expect(nov1.expired).toBe(0);
    expect(db.rows[0]?.status).toBe("TRIAL");
    vi.setSystemTime(new Date(rollingEnd));
    const after = await runBillingSweep(db.supabase as never);
    vi.useRealTimers();
    expect(after.expired).toBe(1);
    expect(db.rows[0]?.status).toBe("EXPIRED");
  });

  it("does not rewrite an already EXPIRED account", async () => {
    const db = sweepDb([
      {
        id: "expired-1",
        organization_id: "org-x",
        status: "EXPIRED",
        cancel_at_period_end: false,
        current_period_end: ended,
        razorpay_subscription_id: null,
      },
    ]);
    const result = await runBillingSweep(db.supabase as never);
    expect(result.expired).toBe(0);
    expect(db.history).toHaveLength(0);
  });

  it("skips when a captured payment activated the row between select and update", async () => {
    const row = trialRow("race-1", "org-race");
    const db = sweepDb([row], [], {
      beforeUpdate: () => {
        row.status = "ACTIVE";
        row.current_period_end = live;
      },
    });
    const result = await runBillingSweep(db.supabase as never);
    expect(result.expired).toBe(0);
    expect(row.status).toBe("ACTIVE");
    expect(db.history).toHaveLength(0);
  });

  it("skips when an admin extends the trial period between select and update", async () => {
    const row = trialRow("extend-1", "org-extend");
    const db = sweepDb([row], [], {
      beforeUpdate: () => {
        row.current_period_end = live;
      },
    });
    const result = await runBillingSweep(db.supabase as never);
    expect(result.expired).toBe(0);
    expect(row.status).toBe("TRIAL");
    expect(row.current_period_end).toBe(live);
    expect(db.history).toHaveLength(0);
  });

  it("keeps concurrent sweeps from writing duplicate history", async () => {
    const db = sweepDb([trialRow("conc-1", "org-c")]);
    const [a, b] = await Promise.all([runBillingSweep(db.supabase as never), runBillingSweep(db.supabase as never)]);
    expect(a.expired + b.expired).toBe(1);
    expect(db.history).toHaveLength(1);
    expect(db.rows[0]?.status).toBe("EXPIRED");
  });

  it("does not expire an admin-extended trial whose period is still in the future", async () => {
    const db = sweepDb([trialRow("admin-1", "org-admin", { current_period_end: live })]);
    const result = await runBillingSweep(db.supabase as never);
    expect(result.expired).toBe(0);
    expect(db.rows[0]?.status).toBe("TRIAL");
  });

  it("expires PAYMENT_FAILED coverage that has ended", async () => {
    const db = sweepDb([
      {
        id: "fail-1",
        organization_id: "org-fail",
        status: "PAYMENT_FAILED",
        cancel_at_period_end: false,
        current_period_end: ended,
        razorpay_subscription_id: null,
      },
    ]);
    const result = await runBillingSweep(db.supabase as never);
    expect(result.expired).toBe(1);
    expect(db.rows[0]?.status).toBe("EXPIRED");
  });

  it("does not insert expiring-soon notices without a uniqueness constraint", async () => {
    expect(BILLING_EXPIRING_NOTICES_ENABLED).toBe(false);
    const soon = new Date(Date.now() + 2 * 86400000).toISOString();
    const db = sweepDb([
      {
        id: "paid-soon",
        organization_id: "org-soon",
        status: "ACTIVE",
        cancel_at_period_end: false,
        current_period_end: soon,
        razorpay_subscription_id: "sub_rzp",
      },
    ]);
    const first = await runBillingSweep(db.supabase as never);
    const second = await runBillingSweep(db.supabase as never);
    const [left, right] = await Promise.all([
      runBillingSweep(db.supabase as never),
      runBillingSweep(db.supabase as never),
    ]);
    expect(first.expiringNotices + second.expiringNotices + left.expiringNotices + right.expiringNotices).toBe(0);
    expect(db.notices).toHaveLength(0);
  });

  it("surfaces a database failure instead of reporting success", async () => {
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          in() {
            return this;
          },
          lte() {
            return this;
          },
          then(resolve: (value: unknown) => void) {
            resolve({ data: null, error: { message: "relation subscriptions does not exist" } });
          },
        };
      },
    };
    await expect(runBillingSweep(supabase as never)).rejects.toThrow("relation subscriptions does not exist");
  });

  it("copies billing-cron.mjs into the production Docker image", () => {
    const dockerfile = readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
    expect(dockerfile).toContain("COPY --from=builder --chown=node:node /app/scripts/billing-cron.mjs ./scripts/billing-cron.mjs");
    expect(dockerfile).toContain("ENV PORT=3000");
  });
});
