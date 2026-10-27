import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/modules/billing/audit", () => ({ writeSubscriptionHistory: vi.fn() }));
vi.mock("@/lib/notifications/billing", () => ({ insertBillingNotification: vi.fn(), BILLING_NOTICE: { expiring: {} } }));
vi.mock("@/modules/razorpay/config", () => ({ isBillingConfiguredAsync: async () => false }));
vi.mock("@/modules/razorpay/client", () => ({ fetchRazorpaySubscription: vi.fn() }));

import { runBillingSweep } from "@/modules/billing/cron";

type Row = Record<string, unknown>;

function fakeDb(rows: Row[]) {
  return {
    from() {
      const filters: Array<(row: Row) => boolean> = [];
      let patch: Row | null = null;
      const query: Record<string, unknown> = {
        select: () => query,
        update(next: Row) {
          patch = next;
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return query;
        },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        lte(column: string, value: string) {
          filters.push((row) => String(row[column]) <= value);
          return query;
        },
        gte(column: string, value: string) {
          filters.push((row) => String(row[column]) >= value);
          return query;
        },
        then(resolve: (value: unknown) => void) {
          const matched = rows.filter((row) => filters.every((filter) => filter(row)));
          if (patch) for (const row of matched) Object.assign(row, patch);
          resolve({ data: patch ? null : matched, error: null });
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

const ended = new Date(Date.now() - 86400000).toISOString();

describe("runBillingSweep", () => {
  it("expires a one-time paid period once it ends", async () => {
    const rows = [{ id: "s1", organization_id: "o1", status: "ACTIVE", cancel_at_period_end: false, current_period_end: ended, razorpay_subscription_id: null }];
    await runBillingSweep(fakeDb(rows));
    expect(rows[0].status).toBe("EXPIRED");
  });

  it("leaves a Razorpay recurring subscription to renew", async () => {
    const rows = [{ id: "s1", organization_id: "o1", status: "ACTIVE", cancel_at_period_end: false, current_period_end: ended, razorpay_subscription_id: "sub_rzp" }];
    await runBillingSweep(fakeDb(rows));
    expect(rows[0].status).toBe("ACTIVE");
  });
});
