import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { handleTariffRoutes } from "./tariff";
import { permissionForTenantRoute } from "@/lib/api/v1-permissions";
import { lockedFeatureForApi, FEATURE } from "@/modules/billing/entitlements";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeTariff, loadTariffConnection, loadTariffOrder, saveTariffEstimate } from "@/modules/india-post/tariff";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/logger", () => ({ logInfo: vi.fn(), createRequestId: () => "test-request" }));
vi.mock("@/modules/india-post/tariff", async (original) => ({ ...await original<typeof import("@/modules/india-post/tariff")>(), loadTariffOrder: vi.fn(), loadTariffConnection: vi.fn(), executeTariff: vi.fn(), saveTariffEstimate: vi.fn() }));
const body = { service: "BUSINESS_PARCEL", destinationPincode: "110001", weightGrams: 550, lengthCm: 20, widthCm: 15, heightCm: 10 };
let sequence = 0;
function context(): TenantContext { return { userId: "user", organizationId: `route-org-${++sequence}`, organizationName: "Test", email: null, fullName: null, role: "ADMIN", permissions: ["orders.read", "orders.write"] }; }
function request(path: string, data: unknown = body, method = "POST") { return new NextRequest(`http://localhost/api/v1/${path}`, { method, ...(method === "POST" ? { body: JSON.stringify(data), headers: { "Content-Type": "application/json" } } : {}) }); }
const db = {} as SupabaseClient;
beforeEach(() => {
  vi.clearAllMocks(); env.indiaPostTariffQuotesEnabled = true;
  vi.mocked(loadTariffConnection).mockResolvedValue({ id: "conn", organization_id: "org", environment: "UAT", status: "CONNECTED", pickup_office_pincode: "400001" });
  vi.mocked(executeTariff).mockResolvedValue({ estimatedTotal: 152, calculatedAt: "2026-10-16T00:00:00.000Z" } as Awaited<ReturnType<typeof executeTariff>>);
  vi.mocked(saveTariffEstimate).mockResolvedValue(undefined);
});
describe("tariff routes", () => {
  it("defaults off in configuration", async () => {
    const source = await import("node:fs/promises");
    expect(await source.readFile(".env.example", "utf8")).toContain("INDIA_POST_TARIFF_QUOTES_ENABLED=false");
  });
  it("disabled capabilities do not touch database or credentials", async () => {
    env.indiaPostTariffQuotesEnabled = false;
    const result = await handleTariffRoutes(request("india-post/tariff-capabilities", null, "GET"), db, context(), "india-post/tariff-capabilities");
    expect((await result!.json()).data.enabled).toBe(false);
    expect(result!.headers.get("Cache-Control")).toBe("private, no-store");
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it("disabled POST makes no credential or provider calls", async () => {
    env.indiaPostTariffQuotesEnabled = false;
    await expect(handleTariffRoutes(request("india-post/tariff-quotes"), db, context(), "india-post/tariff-quotes")).rejects.toMatchObject({ details: { category: "FEATURE_DISABLED" } });
    expect(createAdminClient).not.toHaveBeenCalled(); expect(executeTariff).not.toHaveBeenCalled();
  });
  it("denies users without the required permission", async () => {
    await expect(handleTariffRoutes(request("india-post/tariff-quotes"), db, { ...context(), permissions: ["orders.read"] }, "india-post/tariff-quotes")).rejects.toMatchObject({ status: 403 });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it("quotes an unsaved manual order with server-derived tenant", async () => {
    const ctx = context();
    const result = await handleTariffRoutes(request("india-post/tariff-quotes"), db, ctx, "india-post/tariff-quotes");
    expect((await result!.json()).data.estimatedTotal).toBe(152);
    expect(loadTariffOrder).not.toHaveBeenCalled();
    expect(executeTariff).toHaveBeenCalledWith(expect.anything(), ctx.organizationId, expect.anything(), expect.objectContaining({ sourcePincode: "400001", weightGrams: 550 }));
  });
  it("rejects organization and credential tampering before provider calls", async () => {
    await expect(handleTariffRoutes(request("india-post/tariff-quotes", { ...body, organization_id: "victim", access_token: "secret" }), db, context(), "india-post/tariff-quotes")).rejects.toMatchObject({ status: 422 });
    expect(executeTariff).not.toHaveBeenCalled();
  });
  it("checks existing-order ownership before loading credentials", async () => {
    vi.mocked(loadTariffOrder).mockRejectedValueOnce(new Error("not found"));
    await expect(handleTariffRoutes(request("orders/victim/tariff-quote"), db, context(), "orders/victim/tariff-quote")).rejects.toThrow();
    expect(createAdminClient).not.toHaveBeenCalled(); expect(executeTariff).not.toHaveBeenCalled(); expect(saveTariffEstimate).not.toHaveBeenCalled();
  });
  it("uses the order destination and saves the successful estimate", async () => {
    vi.mocked(loadTariffOrder).mockResolvedValueOnce({ shipping_address: { pincode: "600001" }, order_line_items: [], shipments: [] });
    const temporary = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "destinationPincode"));
    const ctx = { ...context(), permissions: ["orders.read"] as TenantContext["permissions"] };
    await handleTariffRoutes(request("orders/test/tariff-quote", temporary), db, ctx, "orders/test/tariff-quote");
    expect(loadTariffOrder).toHaveBeenCalledWith(db, ctx.organizationId, "test");
    expect(executeTariff).toHaveBeenCalledWith(expect.anything(), ctx.organizationId, expect.anything(), expect.objectContaining({ destinationPincode: "600001", weightGrams: 550 }));
    expect(saveTariffEstimate).toHaveBeenCalledWith(
      expect.anything(),
      ctx.organizationId,
      "test",
      expect.objectContaining({ destinationPincode: "600001", weightGrams: 550 }),
      expect.objectContaining({ estimatedTotal: 152 })
    );
  });
  it("does not save an estimate when the provider quote fails", async () => {
    vi.mocked(loadTariffOrder).mockResolvedValueOnce({ shipping_address: { pincode: "600001" }, order_line_items: [], shipments: [] });
    vi.mocked(executeTariff).mockRejectedValueOnce(new Error("provider failed"));
    const temporary = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "destinationPincode"));
    await expect(handleTariffRoutes(request("orders/test/tariff-quote", temporary), db, context(), "orders/test/tariff-quote")).rejects.toThrow();
    expect(saveTariffEstimate).not.toHaveBeenCalled();
  });
  it("limits attempts per organization", async () => {
    const ctx = context();
    for (let i = 0; i < 90; i++) await handleTariffRoutes(request("india-post/tariff-quotes"), db, ctx, "india-post/tariff-quotes");
    await expect(handleTariffRoutes(request("india-post/tariff-quotes"), db, ctx, "india-post/tariff-quotes")).rejects.toMatchObject({ status: 429 });
    expect(executeTariff).toHaveBeenCalledTimes(90);
  });
  it("allows two concurrent quotes, rejects a third, and releases the guard", async () => {
    let rejectFirst!: (error: Error) => void;
    let rejectSecond!: (error: Error) => void;
    vi.mocked(executeTariff)
      .mockImplementationOnce(() => new Promise((_resolve, fail) => { rejectFirst = fail; }))
      .mockImplementationOnce(() => new Promise((_resolve, fail) => { rejectSecond = fail; }));
    const ctx = context();
    const first = handleTariffRoutes(request("india-post/tariff-quotes"), db, ctx, "india-post/tariff-quotes");
    const second = handleTariffRoutes(request("india-post/tariff-quotes"), db, ctx, "india-post/tariff-quotes");
    await vi.waitFor(() => expect(executeTariff).toHaveBeenCalledTimes(2));
    await expect(handleTariffRoutes(request("india-post/tariff-quotes"), db, ctx, "india-post/tariff-quotes")).rejects.toMatchObject({ status: 429 });
    rejectFirst(new Error("secret")); rejectSecond(new Error("secret"));
    await expect(first).rejects.not.toThrow("secret");
    await expect(second).rejects.not.toThrow("secret");
    await expect(handleTariffRoutes(request("india-post/tariff-quotes"), db, ctx, "india-post/tariff-quotes")).resolves.toBeInstanceOf(Response);
  });
  it("maps permissions and retains India Post subscription gates", () => {
    expect(permissionForTenantRoute("POST", "india-post/tariff-quotes", ["india-post", "tariff-quotes"])).toBe("orders.write");
    expect(permissionForTenantRoute("POST", "orders/id/tariff-quote", ["orders", "id", "tariff-quote"])).toBe("orders.read");
    expect(permissionForTenantRoute("GET", "india-post/tariff-capabilities", ["india-post", "tariff-capabilities"])).toBe("orders.read");
    expect(lockedFeatureForApi("POST", "orders/id/tariff-quote", ["orders", "id", "tariff-quote"])).toBe(FEATURE.indiaPost);
  });
});
