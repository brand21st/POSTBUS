import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { checkStoreAddress, storefrontPublicPath, updateStoreAddress } from "@/modules/storefront/service";

vi.mock("@/modules/customer-order-links/service", () => ({
  getMerchantCollectionLink: vi.fn(async () => ({
    id: "link-1",
    slug: "samanga",
    publicId: "4821",
    url: "https://www.postbus.in/order/4821/samanga/WhatsApp-order-form",
    status: "ACTIVE",
  })),
}));

import { getMerchantCollectionLink } from "@/modules/customer-order-links/service";

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops",
  organizationId: "org-1",
  organizationName: "Samanga",
  role: "OWNER",
  permissions: ["inventory.write"],
};

describe("storefrontPublicPath", () => {
  it("creates the merchant collection link before advertising the WhatsApp store URL", async () => {
    const path = await storefrontPublicPath({} as never, "org-1", ctx);
    expect(getMerchantCollectionLink).toHaveBeenCalledWith({}, ctx);
    expect(path.workspace).toBe("samanga");
    expect(path.storePath).toBe("/store/samanga");
    expect(path.legacyPath).toBe("/order/4821/samanga/WhatsApp-order-form");
  });

  it("does not create a collection link on the anonymous public store load", async () => {
    vi.mocked(getMerchantCollectionLink).mockClear();
    const supabase = {
      from: (table: string) => {
        const result =
          table === "organizations"
            ? { data: { name: "Samanga", slug: "samanga" }, error: null }
            : { data: null, error: null };
        const query: Record<string, unknown> = {
          select: () => query,
          eq: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: () => Promise.resolve(result),
        };
        return query;
      },
    };
    const path = await storefrontPublicPath(supabase as never, "org-1");
    expect(getMerchantCollectionLink).not.toHaveBeenCalled();
    expect(path.storeUrl).toMatch(/\/store\/samanga$/);
  });
});

type Call = { table: string; method: string; args: unknown[] };

/** Chainable Supabase stand-in: every builder call is recorded and awaiting resolves to the table's result. */
function fakeSupabase(results: Record<string, (calls: Call[]) => { data: unknown; error: unknown }>) {
  const calls: Call[] = [];
  const builder = (table: string): unknown => {
    const own: Call[] = [];
    const resolve = () => (results[table] ?? (() => ({ data: null, error: null })))(own);
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, method: string) {
          if (method === "then") return (ok: (value: unknown) => unknown, fail: (reason: unknown) => unknown) => Promise.resolve(resolve()).then(ok, fail);
          return (...args: unknown[]) => {
            const call = { table, method, args };
            own.push(call);
            calls.push(call);
            return proxy;
          };
        },
      }
    );
    return proxy;
  };
  return { client: { from: builder, rpc: () => builder("rpc"), storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) } }, calls };
}

describe("store address", () => {
  it("rejects malformed and reserved addresses before touching the database", async () => {
    const { client, calls } = fakeSupabase({});
    await expect(checkStoreAddress(client as never, ctx, "My Shop")).resolves.toMatchObject({ available: false, reason: expect.stringContaining("lowercase") });
    await expect(checkStoreAddress(client as never, ctx, "ab")).resolves.toMatchObject({ available: false });
    await expect(checkStoreAddress(client as never, ctx, "dashboard")).resolves.toMatchObject({ available: false, reason: expect.stringContaining("reserved") });
    expect(calls).toHaveLength(0);
  });

  it("reports addresses held by another merchant as taken and our own as available", async () => {
    const taken = fakeSupabase({ customer_order_links: () => ({ data: { organization_id: "org-2" }, error: null }) });
    await expect(checkStoreAddress(taken.client as never, ctx, " Kala-Ghar ")).resolves.toEqual({ slug: "kala-ghar", available: false, reason: "That address is already taken." });
    const ours = fakeSupabase({ customer_order_links: () => ({ data: { organization_id: "org-1" }, error: null }) });
    await expect(checkStoreAddress(ours.client as never, ctx, "kala-ghar")).resolves.toMatchObject({ available: true });
  });

  it("only lets owners and admins change the address", async () => {
    const { client } = fakeSupabase({});
    await expect(updateStoreAddress(client as never, { ...ctx, role: "OPERATOR" }, "kala-ghar")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a taken address, including one claimed between the check and the update", async () => {
    const taken = fakeSupabase({ customer_order_links: () => ({ data: { organization_id: "org-2" }, error: null }) });
    await expect(updateStoreAddress(taken.client as never, ctx, "kala-ghar")).rejects.toMatchObject({ code: "CONFLICT" });
    const raced = fakeSupabase({
      customer_order_links: (own) =>
        own.some((call) => call.method === "update") ? { data: null, error: { code: "23505", message: "duplicate key" } } : { data: null, error: null },
    });
    await expect(updateStoreAddress(raced.client as never, ctx, "kala-ghar")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("moves the active link to the new address and audits the change", async () => {
    const { client, calls } = fakeSupabase({});
    const settings = await updateStoreAddress(client as never, ctx, "kala-ghar");
    expect(calls).toContainEqual({ table: "customer_order_links", method: "update", args: [{ public_workspace: "kala-ghar" }] });
    expect(calls).toContainEqual({ table: "customer_order_links", method: "eq", args: ["id", "link-1"] });
    expect(calls).toContainEqual({ table: "customer_order_links", method: "eq", args: ["organization_id", "org-1"] });
    expect(calls).toContainEqual(
      expect.objectContaining({ table: "audit_logs", method: "insert", args: [expect.objectContaining({ action: "storefront.address_changed", before: { storeAddress: "samanga" }, after: { storeAddress: "kala-ghar" } })] })
    );
    expect(settings.workspace).toBe("samanga");
  });

  it("skips the update when the address is unchanged", async () => {
    const { client, calls } = fakeSupabase({});
    await updateStoreAddress(client as never, ctx, "samanga");
    expect(calls.some((call) => call.method === "update")).toBe(false);
  });
});
