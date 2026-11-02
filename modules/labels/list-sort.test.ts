import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { listGroupedLabels } from "@/modules/labels/list";

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "OPERATOR",
  permissions: ["labels.read"],
};

function listClient() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    from() {
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              in: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      };
    },
    rpc(_name: string, args: Record<string, unknown>) {
      calls.push(args);
      return Promise.resolve({ data: [], error: null });
    },
  };
}

describe("listGroupedLabels sort", () => {
  it("passes numeric order-id sort to label_shipment_groups", async () => {
    const client = listClient();
    await listGroupedLabels(client as never, ctx, {
      page: 1,
      pageSize: 20,
      sort: "-order_number",
    });
    expect(client.calls[0]?.p_sort).toBe("-order_number");
  });

  it("omits unknown sort values", async () => {
    const client = listClient();
    await listGroupedLabels(client as never, ctx, { page: 1, pageSize: 20, sort: "amount" });
    expect(client.calls[0]?.p_sort).toBeUndefined();
  });
});
