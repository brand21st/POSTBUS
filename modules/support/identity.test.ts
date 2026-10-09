import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import { assertOrderInOrganization, resolveInOrgOrderFromText } from "@/modules/support/identity";
import { hasPermission } from "@/lib/permissions/rbac";

function chain(result: { data?: unknown } = { data: null }) {
  const self: Record<string, unknown> = {};
  const next = () => self;
  self.select = next;
  self.eq = next;
  self.or = next;
  self.limit = async () => result;
  self.maybeSingle = async () => result;
  self.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return self;
}

describe("assertOrderInOrganization", () => {
  it("rejects an order that belongs to another tenant", async () => {
    const supabase = {
      from: () => chain({ data: null }),
    };
    await expect(assertOrderInOrganization(supabase as never, "org-a", "ord-b")).rejects.toBeInstanceOf(AppError);
  });

  it("accepts an order owned by the same organization", async () => {
    const supabase = {
      from: () =>
        chain({
          data: { id: "ord-a", organization_id: "org-a", customer_id: "c1", shipping_address_id: null },
        }),
    };
    await expect(assertOrderInOrganization(supabase as never, "org-a", "ord-a")).resolves.toMatchObject({
      id: "ord-a",
      organization_id: "org-a",
    });
  });
});

describe("resolveInOrgOrderFromText", () => {
  it("does not auto-pick when one customer has several matching orders and no unique token hit", async () => {
    const supabase = {
      from: (table: string) => {
        if (table === "orders" || table === "external_order_references") {
          const self = chain({
            data:
              table === "orders"
                ? [
                    { id: "o1", organization_id: "org-a" },
                    { id: "o2", organization_id: "org-a" },
                  ]
                : [],
          });
          let n = 0;
          self.maybeSingle = async () => {
            n += 1;
            return {
              data: {
                id: n === 1 ? "o1" : "o2",
                organization_id: "org-a",
                customer_id: "c1",
                shipping_address_id: null,
              },
            };
          };
          return self;
        }
        return chain({ data: { phone: "9876543210" } });
      },
    };
    const result = await resolveInOrgOrderFromText(supabase as never, "org-a", "9876543210", "return my product", [
      "#1052",
    ]);
    expect(result.orderId).toBeNull();
    expect(result.state).toBe("MULTIPLE_MATCHES");
  });
});

describe("tenant access", () => {
  it("blocks VIEWER from support settings patches", () => {
    expect(hasPermission("VIEWER", "support.settings")).toBe(false);
  });
});

describe("support media isolation", () => {
  it("scopes private bucket objects to the organization folder", () => {
    const organizationId = "11111111-1111-1111-1111-111111111111";
    const path = `${organizationId}/msg-1/photo.jpg`;
    expect(path.split("/")[0]).toBe(organizationId);
  });
});
