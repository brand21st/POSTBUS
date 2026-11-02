import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { storefrontPublicPath } from "@/modules/storefront/service";

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
