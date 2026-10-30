import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/razorpay/config", () => ({
  isBillingConfiguredAsync: async () => false,
}));

import { runBillingSweep } from "@/modules/billing/cron";

function sweepDb(rows: Array<Record<string, unknown>>) {
  const history: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
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
        lte() {
          return query;
        },
        gte() {
          return query;
        },
        not() {
          return query;
        },
        then(resolve: (value: unknown) => void) {
          if (table !== "subscriptions") {
            resolve({ data: [], error: null });
            return;
          }
          const statuses = filters.status as string[] | undefined;
          const statusEq = filters.status as string | undefined;
          const data = rows.filter((row) => {
            if (statuses) return statuses.includes(String(row.status));
            if (statusEq) return row.status === statusEq;
            return true;
          });
          resolve({ data, error: null });
        },
        update(patch: Record<string, unknown>) {
          return {
            async eq(column: string, value: unknown) {
              const row = rows.find((item) => item[column] === value);
              if (row) Object.assign(row, patch);
              return { error: null };
            },
          };
        },
        insert: async (row: Record<string, unknown>) => {
          history.push(row);
          return { error: null };
        },
      };
      return query;
    },
  };
  return { supabase, rows, history };
}

describe("runBillingSweep", () => {
  it("expires ended trials but does not expire an uncanceled paid ACTIVE period", async () => {
    const db = sweepDb([
      {
        id: "trial-1",
        organization_id: "org-1",
        status: "TRIAL",
        cancel_at_period_end: false,
        current_period_end: "2026-10-20T00:00:00.000Z",
        razorpay_subscription_id: null,
      },
      {
        id: "paid-1",
        organization_id: "org-2",
        status: "ACTIVE",
        cancel_at_period_end: false,
        current_period_end: "2026-10-20T00:00:00.000Z",
        razorpay_subscription_id: "sub_rzp",
      },
    ]);
    const first = await runBillingSweep(db.supabase as never);
    const second = await runBillingSweep(db.supabase as never);
    expect(first.expired).toBe(1);
    expect(second.expired).toBe(0);
    expect(db.rows[0]?.status).toBe("EXPIRED");
    expect(db.rows[1]?.status).toBe("ACTIVE");
  });
});
