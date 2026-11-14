import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { ERROR_CODES } from "@/lib/api/errors";
import { permissionsFor } from "@/lib/permissions/rbac";
import type { MemberRole } from "@/types/domain";

const assertPlanFeature = vi.fn(async () => undefined);
vi.mock("@/modules/billing/entitlements", () => ({
  FEATURE: { packing: "Custom packing labels", multiPrint: "Multi print" },
  lockedFeatureForApi: (_method: string, path: string) => (path === "bookings/queue" ? "bulk" : null),
  assertPlanFeature: (...args: unknown[]) => assertPlanFeature(...(args as [])),
  assertAnyPlanFeature: async () => undefined,
}));

const { dispatchTenantRoutes } = await import("@/lib/api/v1/dispatch");

function ctx(role: MemberRole): TenantContext {
  return {
    userId: "user-1",
    email: null,
    fullName: null,
    organizationId: "org-1",
    organizationName: "Org",
    role,
    permissions: permissionsFor(role),
  };
}

const route = (method: string, path: string) => ({ key: `${method} ${path}`, path, method, slugs: path.split("/") });
const supabase = {} as SupabaseClient;

describe("dispatchTenantRoutes", () => {
  it("enforces route permissions for every caller, not only the cookie path", async () => {
    const request = new NextRequest("http://localhost/api/v1/orders", { method: "POST" });
    await expect(dispatchTenantRoutes(request, supabase, ctx("VIEWER"), route("POST", "orders"))).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it("checks the plan feature before any handler runs", async () => {
    assertPlanFeature.mockRejectedValueOnce(Object.assign(new Error("locked"), { code: ERROR_CODES.FORBIDDEN }));
    const request = new NextRequest("http://localhost/api/v1/bookings/queue", { method: "POST" });
    await expect(
      dispatchTenantRoutes(request, supabase, ctx("OWNER"), route("POST", "bookings/queue"))
    ).rejects.toThrow("locked");
    expect(assertPlanFeature).toHaveBeenCalledWith(supabase, "org-1", "bulk");
  });
});
