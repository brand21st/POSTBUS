import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_CODES } from "@/lib/api/errors";

const getUser = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase/request-auth", () => ({
  getRequestAuthUser: async () => ({
    supabase: { from },
    user: getUser(),
  }),
}));

describe("requireTenant", () => {
  beforeEach(() => {
    getUser.mockReset();
    from.mockReset();
    vi.resetModules();
  });

  it("returns tenant context for an authenticated member", async () => {
    getUser.mockReturnValue({ id: "user-1", email: "a@example.com" });
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "user-1",
                  email: "a@example.com",
                  full_name: "Ada",
                  active_organization_id: "org-1",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { role: "OWNER", organizations: { id: "org-1", name: "Ada Co" } },
                error: null,
              }),
            }),
          }),
        }),
      };
    });

    const { requireTenant } = await import("@/lib/api/context");
    const ctx = await requireTenant("orders.read");
    expect(ctx.organizationId).toBe("org-1");
    expect(ctx.userId).toBe("user-1");
    expect(ctx.permissions).toContain("orders.read");
  });

  it("rejects an unauthenticated request", async () => {
    getUser.mockReturnValue(null);
    const { requireTenant } = await import("@/lib/api/context");
    await expect(requireTenant()).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_REQUIRED,
    });
  });

  it("rejects a user without membership in the active workspace", async () => {
    getUser.mockReturnValue({ id: "user-1", email: "a@example.com" });
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "user-1", active_organization_id: "org-other" },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };
    });
    const { requireTenant } = await import("@/lib/api/context");
    await expect(requireTenant()).rejects.toMatchObject({
      code: ERROR_CODES.TENANT_ACCESS_DENIED,
    });
  });

  it("enforces feature-style permission checks on the resolved role", async () => {
    getUser.mockReturnValue({ id: "user-1", email: "a@example.com" });
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "user-1", active_organization_id: "org-1" },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { role: "VIEWER", organizations: { id: "org-1", name: "Ada Co" } },
                error: null,
              }),
            }),
          }),
        }),
      };
    });
    const { requireTenant } = await import("@/lib/api/context");
    await expect(requireTenant("orders.write")).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });
});
