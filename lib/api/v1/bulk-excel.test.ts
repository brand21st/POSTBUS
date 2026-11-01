import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { ERROR_CODES } from "@/lib/api/errors";
import { permissionForTenantRoute } from "@/lib/api/v1-permissions";
import { FEATURE, lockedFeatureForApi } from "@/modules/billing/entitlements";
import { writeWorkbook } from "@/lib/xlsx/write";

const createImportBatch = vi.fn();
const confirmImportBatch = vi.fn();
const validateImportBatch = vi.fn();
const getImportBatch = vi.fn();
const retryImportFailures = vi.fn();
const listMappingProfiles = vi.fn();

vi.mock("@/modules/india-post/bulk-excel-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/india-post/bulk-excel-import")>();
  return {
    ...actual,
    createImportBatch: (...args: unknown[]) => createImportBatch(...args),
    confirmImportBatch: (...args: unknown[]) => confirmImportBatch(...args),
    validateImportBatch: (...args: unknown[]) => validateImportBatch(...args),
    getImportBatch: (...args: unknown[]) => getImportBatch(...args),
    retryImportFailures: (...args: unknown[]) => retryImportFailures(...args),
    listMappingProfiles: (...args: unknown[]) => listMappingProfiles(...args),
  };
});

const { handleCommerceRoutes } = await import("@/lib/api/v1/commerce");

const orgCtx: TenantContext = {
  userId: "user-1",
  email: "merchant@example.com",
  fullName: "Merchant",
  organizationId: "org-1",
  organizationName: "Org One",
  role: "OWNER",
  permissions: ["*"],
};

const otherCtx: TenantContext = { ...orgCtx, organizationId: "org-2", userId: "user-2" };

function request(path: string, init?: RequestInit) {
  return new NextRequest(`http://localhost/api/v1/${path}`, init);
}

async function commerce(req: NextRequest, ctx: TenantContext) {
  const slugs = req.nextUrl.pathname.replace("/api/v1/", "").split("/").filter(Boolean);
  return handleCommerceRoutes(req, {} as SupabaseClient, ctx, `${req.method} ${slugs.join("/")}`, req.method, slugs);
}

describe("bulk excel booking APIs", () => {
  it("gates the new routes on bulk plan and shipment write", () => {
    expect(permissionForTenantRoute("POST", "bookings/excel-imports", ["bookings", "excel-imports"])).toBe(
      "shipments.write"
    );
    expect(permissionForTenantRoute("GET", "bookings/excel-template", ["bookings", "excel-template"])).toBe(
      "shipments.read"
    );
    expect(permissionForTenantRoute("POST", "bookings/excel-imports/abc/confirm", ["bookings", "excel-imports", "abc", "confirm"])).toBe(
      "shipments.write"
    );
    expect(lockedFeatureForApi("POST", "bookings/excel-imports", ["bookings", "excel-imports"])).toBe(FEATURE.bulk);
    expect(lockedFeatureForApi("GET", "bookings/excel-template", ["bookings", "excel-template"])).toBe(FEATURE.bulk);
  });

  it("serves the Excel template without creating a booking", async () => {
    const result = await commerce(request("bookings/excel-template"), orgCtx);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(createImportBatch).not.toHaveBeenCalled();
    expect(confirmImportBatch).not.toHaveBeenCalled();
  });

  it("rejects an upload with no workbook", async () => {
    const req = request("bookings/excel-imports", { method: "POST", body: new FormData() });
    await expect(commerce(req, orgCtx)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Upload an Excel workbook.",
    });
    expect(confirmImportBatch).not.toHaveBeenCalled();
  });

  it("parses an upload into a draft batch and never confirms booking", async () => {
    createImportBatch.mockResolvedValueOnce({ id: "batch-1", status: "mapped", total: 2, valid: 0 });
    const bytes = await writeWorkbook([
      {
        name: "Shipments",
        rows: [
          ["RECEIVER NAME", "RECEIVER MOBILE NO", "RECEIVER PINCODE", "RECEIVER ADD LINE 1", "PHYSICAL WEIGHT"],
          ["Asha", "9876543210", "600052", "12 Market Road", "500"],
        ],
      },
    ]);
    const form = new FormData();
    form.set("file", new File([bytes], "postbridge.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const result = await commerce(request("bookings/excel-imports", { method: "POST", body: form }), orgCtx);
    expect(result).toEqual({ id: "batch-1", status: "mapped", total: 2, valid: 0 });
    expect(createImportBatch).toHaveBeenCalledWith(expect.anything(), orgCtx, expect.any(ArrayBuffer), "postbridge.xlsx", undefined);
    expect(confirmImportBatch).not.toHaveBeenCalled();
  });

  it("keeps validation separate from India Post confirmation", async () => {
    validateImportBatch.mockResolvedValueOnce({ id: "batch-1", status: "validated", valid: 1 });
    const result = await commerce(request("bookings/excel-imports/batch-1/validate", { method: "POST" }), orgCtx);
    expect(result).toMatchObject({ status: "validated" });
    expect(validateImportBatch).toHaveBeenCalledWith(expect.anything(), orgCtx, "batch-1");
    expect(confirmImportBatch).not.toHaveBeenCalled();
  });

  it("confirms booking only on the confirm route and scopes the batch to the caller org", async () => {
    confirmImportBatch.mockResolvedValueOnce({ status: "booking", booked: false });
    await commerce(request("bookings/excel-imports/batch-1/confirm", { method: "POST" }), orgCtx);
    expect(confirmImportBatch).toHaveBeenCalledWith(expect.anything(), orgCtx, "batch-1");

    getImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-1" });
    await commerce(request("bookings/excel-imports/batch-1"), otherCtx);
    expect(getImportBatch).toHaveBeenCalledWith(expect.anything(), otherCtx, "batch-1");
  });

  it("retries only through the retry route", async () => {
    retryImportFailures.mockResolvedValueOnce({ retried: 1 });
    const result = await commerce(request("bookings/excel-imports/batch-1/retry", { method: "POST" }), orgCtx);
    expect(result).toEqual({ retried: 1 });
    expect(retryImportFailures).toHaveBeenCalledWith(expect.anything(), orgCtx, "batch-1");
  });
});
