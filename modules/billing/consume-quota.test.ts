import { describe, expect, it, vi } from "vitest";
import { consumeQuota } from "@/modules/billing/usage";

function chain(result: unknown, inserts: unknown[]) {
  const self: Record<string, unknown> = {};
  const next = () => self;
  self.select = next;
  self.eq = next;
  self.in = next;
  self.order = next;
  self.limit = next;
  self.update = next;
  self.maybeSingle = async () => ({ data: result, error: null });
  self.single = async () => ({ data: result, error: null });
  self.insert = async (row: unknown) => {
    inserts.push(row);
    return { error: null };
  };
  return self;
}

function mockSupabase(options?: { consume?: unknown }) {
  const inserts: unknown[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "ensure_billing_period") {
      return {
        data: {
          id: "usage-1",
          orders_used: 2,
          order_limit: 100,
          period_start: "2026-10-01",
          period_end: "2026-11-01",
          alert_80_sent_at: null,
          alert_90_sent_at: null,
          alert_100_sent_at: null,
        },
        error: null,
      };
    }
    if (name === "consume_order_quota") {
      return {
        data: options?.consume ?? [{ orders_used: 7, order_limit: 100 }],
        error: null,
        args,
      };
    }
    return { data: null, error: null };
  });
  const supabase = {
    rpc,
    inserts,
    from: (table: string) => {
      if (table === "organizations") return chain({ account_status: "ACTIVE" }, inserts);
      if (table === "subscriptions") {
        return chain(
          {
            id: "sub-1",
            status: "ACTIVE",
            order_limit: 100,
            current_period_start: "2026-10-01",
            current_period_end: "2026-11-01",
            plans: { name: "Pro", monthly_order_limit: 100 },
          },
          inserts
        );
      }
      if (table === "billing_usage") {
        return chain(
          {
            id: "usage-1",
            orders_used: 2,
            order_limit: 100,
            alert_80_sent_at: "done",
            alert_90_sent_at: "done",
            alert_100_sent_at: "done",
          },
          inserts
        );
      }
      if (table === "usage_events") return chain(null, inserts);
      return chain(null, inserts);
    },
  };
  return supabase;
}

describe("consumeQuota quantity", () => {
  it("no-ops when quantity is 0", async () => {
    const supabase = mockSupabase();
    await expect(consumeQuota(supabase as never, "org-1", 0)).resolves.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("keeps { p_org } for a single order", async () => {
    const supabase = mockSupabase();
    await consumeQuota(supabase as never, "org-1", 1);
    const consume = supabase.rpc.mock.calls.find(([name]) => name === "consume_order_quota");
    expect(consume?.[1]).toEqual({ p_org: "org-1" });
    expect(supabase.inserts).toContainEqual({
      organization_id: "org-1",
      metric: "shipments",
      quantity: 1,
    });
  });

  it("sends one RPC for N booked ids", async () => {
    const supabase = mockSupabase();
    await consumeQuota(supabase as never, "org-1", 5);
    const consumeCalls = supabase.rpc.mock.calls.filter(([name]) => name === "consume_order_quota");
    expect(consumeCalls).toHaveLength(1);
    expect(consumeCalls[0]?.[1]).toEqual({ p_org: "org-1", p_quantity: 5 });
    expect(supabase.inserts).toContainEqual({
      organization_id: "org-1",
      metric: "shipments",
      quantity: 5,
    });
  });
});
