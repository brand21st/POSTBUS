import { describe, expect, it, vi } from "vitest";
import { checkQuota } from "@/modules/billing/usage";
import { TRIAL_ENDED_MESSAGE } from "@/modules/billing/trial-policy";

function chain(result: unknown) {
  const self: Record<string, unknown> = {};
  const next = () => self;
  self.select = next;
  self.eq = next;
  self.in = next;
  self.order = next;
  self.limit = next;
  self.maybeSingle = async () => ({ data: result, error: null });
  return self;
}

describe("checkQuota after trial expiry", () => {
  it("blocks booking while status is still TRIAL past trial_end", async () => {
    const supabase = {
      rpc: vi.fn(async () => ({
        data: {
          orders_used: 1,
          order_limit: 10000,
          period_start: "2026-10-01",
          period_end: "2026-10-20",
          alert_80_sent_at: null,
          alert_90_sent_at: null,
          alert_100_sent_at: null,
        },
        error: null,
      })),
      from: (table: string) => {
        if (table === "organizations") return chain({ account_status: "ACTIVE" });
        if (table === "subscriptions") {
          return chain({
            id: "sub-1",
            status: "TRIAL",
            order_limit: 10000,
            current_period_start: "2026-10-01",
            current_period_end: "2026-10-20T00:00:00.000Z",
            expires_at: "2026-10-20T00:00:00.000Z",
            trial_end: "2026-10-20T00:00:00.000Z",
            cancel_at_period_end: false,
            razorpay_subscription_id: null,
            plans: { name: "Business", monthly_order_limit: 10000 },
          });
        }
        if (table === "plans") return chain({ monthly_order_limit: 10000 });
        return chain(null);
      },
    };
    await expect(checkQuota(supabase as never, "org-1", 1)).rejects.toThrow(TRIAL_ENDED_MESSAGE);
  });
});
