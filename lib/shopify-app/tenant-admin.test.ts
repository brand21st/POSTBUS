import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/errors";
import { assertOrganizationMatch, createShopifyTenantAdmin } from "@/lib/shopify-app/tenant-admin";

const eqCalls: { table: string; column: string; value: string }[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: vi.fn(),
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: string) => {
          eqCalls.push({ table, column, value });
          return { eq: () => ({}) };
        },
      }),
    }),
  }),
}));

describe("Shopify tenant authorization", () => {
  beforeEach(() => {
    eqCalls.length = 0;
  });

  it("ignores a matching client-supplied organization id", () => {
    expect(() => assertOrganizationMatch("org-a", "org-a")).not.toThrow();
    expect(() => assertOrganizationMatch("org-a", null)).not.toThrow();
  });

  it("rejects a client-supplied organization id for another shop", () => {
    expect(() => assertOrganizationMatch("org-a", "org-b")).toThrow(AppError);
  });

  it("scopes every table query to the installation organization", () => {
    const tenant = createShopifyTenantAdmin("org-a");
    tenant.from("india_post_connections").select("status");
    tenant.from("shopify_app_installations").select("id");
    tenant.from("organizations").select("name");
    expect(eqCalls).toEqual([
      { table: "india_post_connections", column: "organization_id", value: "org-a" },
      { table: "shopify_app_installations", column: "organization_id", value: "org-a" },
      { table: "organizations", column: "id", value: "org-a" },
    ]);
    expect(() => tenant.from("shopify_connections")).toThrow(AppError);
  });

  it("rejects an empty organization id", () => {
    expect(() => createShopifyTenantAdmin("")).toThrow(AppError);
  });

  it("does not expose unbounded service-role RPC", () => {
    const tenant = createShopifyTenantAdmin("org-a");
    expect(() => tenant.rpc("provision_shopify_app_organization")).toThrow(AppError);
  });
});
