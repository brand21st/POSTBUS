import { describe, expect, it, vi } from "vitest";
import { assignUnassignedThread, identifyGlobalInbound, orderTokensFromText } from "@/modules/support/identify";

vi.mock("@/modules/support/provider", () => ({
  supportInboxAvailable: async () => true,
}));

function chain(result: { data?: unknown; error?: unknown } = { data: null }) {
  const self: Record<string, unknown> = {};
  const next = () => self;
  self.select = next;
  self.eq = next;
  self.or = next;
  self.gt = next;
  self.in = next;
  self.limit = async () => result;
  self.maybeSingle = async () => result;
  self.single = async () => result;
  self.upsert = async () => ({ error: null });
  self.insert = async () => ({ error: null, data: { id: "thread-1" } });
  self.update = () => self;
  self.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return self;
}

function supabaseFor(tables: Record<string, (op?: string) => ReturnType<typeof chain>>) {
  return {
    from: (table: string) => {
      const factory = tables[table];
      if (!factory) return chain({ data: null });
      return factory();
    },
  };
}

describe("identifyGlobalInbound", () => {
  it("extracts explicit order tokens", () => {
    expect(orderTokensFromText("please check PB-11143")).toContain("PB-11143");
    expect(orderTokensFromText("shopify #1052")).toEqual(expect.arrayContaining(["#1052", "1052"]));
  });

  it("assigns Rahul #1052 only when that order is unique and the WhatsApp phone matches", async () => {
    const supabase = supabaseFor({
      organizations: () =>
        chain({ data: { support_center_enabled: true, support_whatsapp_mode: "postbus_global" } }),
      support_global_binds: () => chain({ data: null }),
      support_identity_resolutions: () => chain({ data: null }),
      external_order_references: () => chain({ data: [] }),
      orders: () => {
        const self = chain({
          data: [
            {
              id: "ord-a",
              organization_id: "merchant-a",
              order_number: "#1052",
              source_order_id: "1052",
              customer_id: "c-rahul",
              shipping_address_id: null,
            },
          ],
        });
        self.maybeSingle = async () => ({
          data: {
            id: "ord-a",
            organization_id: "merchant-a",
            customer_id: "c-rahul",
            shipping_address_id: null,
          },
        });
        return self;
      },
      customers: () => chain({ data: { phone: "+919876543210" } }),
      addresses: () => chain({ data: null }),
    });
    const result = await identifyGlobalInbound(supabase as never, {
      phone: "+919876543210",
      text: "I want to return order #1052",
    });
    expect(result).toMatchObject({
      kind: "assigned",
      organizationId: "merchant-a",
      orderId: "ord-a",
      state: "VERIFIED",
    });
  });

  it("quarantines the same Shopify order number across two merchants", async () => {
    const supabase = supabaseFor({
      support_global_binds: () => chain({ data: null }),
      external_order_references: () => chain({ data: [] }),
      orders: () =>
        chain({
          data: [
            { id: "ord-a", organization_id: "merchant-a", order_number: "#1052" },
            { id: "ord-b", organization_id: "merchant-b", order_number: "#1052" },
          ],
        }),
    });
    const result = await identifyGlobalInbound(supabase as never, {
      phone: "+919876543210",
      text: "return #1052",
    });
    expect(result.kind).toBe("unassigned");
    expect(result).toMatchObject({ state: "MULTIPLE_MATCHES" });
  });

  it("does not assign from phone alone when two merchants share the customer number", async () => {
    const supabase = supabaseFor({
      support_global_binds: () => chain({ data: null }),
    });
    const result = await identifyGlobalInbound(supabase as never, {
      phone: "+919876543210",
      text: "I want to return my product",
    });
    expect(result).toMatchObject({ kind: "unassigned", state: "VERIFICATION_REQUIRED" });
  });

  it("rejects an order token when the WhatsApp phone does not match the order", async () => {
    const supabase = supabaseFor({
      organizations: () =>
        chain({ data: { support_center_enabled: true, support_whatsapp_mode: "postbus_global" } }),
      support_global_binds: () => chain({ data: null }),
      support_identity_resolutions: () => chain({ data: null }),
      external_order_references: () => chain({ data: [] }),
      orders: () => {
        const self = chain({
          data: [
            {
              id: "ord-a",
              organization_id: "merchant-a",
              order_number: "#1052",
              customer_id: "c-rahul",
            },
          ],
        });
        self.maybeSingle = async () => ({
          data: { id: "ord-a", organization_id: "merchant-a", customer_id: "c-rahul", shipping_address_id: null },
        });
        return self;
      },
      customers: () => chain({ data: { phone: "+919876543210" } }),
      addresses: () => chain({ data: null }),
    });
    const result = await identifyGlobalInbound(supabase as never, {
      phone: "+919123456780",
      text: "#1052",
    });
    expect(result).toMatchObject({ kind: "unassigned", state: "VERIFICATION_REQUIRED" });
  });

  it("expires a recycled-phone bind that no longer matches the order", async () => {
    const expired: string[] = [];
    const supabase = supabaseFor({
      support_global_binds: () => {
        const self = chain({
          data: { organization_id: "merchant-a", order_id: "ord-old", expires_at: "2099-01-01T00:00:00.000Z" },
        });
        self.update = () => {
          expired.push("yes");
          return self;
        };
        return self;
      },
      orders: () => {
        const self = chain({ data: [] });
        self.maybeSingle = async () => ({ data: { id: "ord-old", organization_id: "merchant-a", customer_id: "c1" } });
        return self;
      },
      customers: () => chain({ data: { phone: "+919876543210" } }),
      addresses: () => chain({ data: null }),
      organizations: () =>
        chain({ data: { support_center_enabled: true, support_whatsapp_mode: "postbus_global" } }),
    });
    const result = await identifyGlobalInbound(supabase as never, {
      phone: "+919000000001",
      text: "hello",
    });
    expect(expired.length).toBeGreaterThan(0);
    expect(result.kind).toBe("unassigned");
  });
});

describe("assignUnassignedThread", () => {
  it("rejects assignment when the thread phone does not match the order", async () => {
    const supabase = supabaseFor({
      orders: () => {
        const self = chain({ data: { id: "ord-a", organization_id: "merchant-a" } });
        self.maybeSingle = async () => ({ data: { id: "ord-a", organization_id: "merchant-a", customer_id: "c-rahul" } });
        return self;
      },
      organizations: () =>
        chain({ data: { support_center_enabled: true, support_whatsapp_mode: "postbus_global" } }),
      support_unassigned_threads: () => {
        const row = { id: "th-1", phone_digits: "9123456780", status: "open", assigned_organization_id: null };
        const self = chain({ data: row });
        self.maybeSingle = async () => ({ data: row });
        return self;
      },
      customers: () => chain({ data: { phone: "+919876543210" } }),
      addresses: () => chain({ data: null }),
    });
    const result = await assignUnassignedThread(supabase as never, { threadId: "th-1", orderId: "ord-a" });
    expect(result.ok).toBe(false);
  });
});
