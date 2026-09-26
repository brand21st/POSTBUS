import { describe, expect, it, vi } from "vitest";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { ndrListQuery } from "@/modules/ndr-rto/schema";
import { getNdrSummary, istDayBounds, listNdrShipments, syncNdrShipment } from "@/modules/ndr-rto/service";

vi.mock("@/modules/india-post/provider", () => ({
  indiaPostFromRow: vi.fn(() => ({
    trackShipment: vi.fn(async () => {
      throw new Error("Tracking lookup failed.");
    }),
  })),
}));

const ctx = { organizationId: "org-a", userId: "user-a", role: "OWNER" } as TenantContext;

describe("ndr list query", () => {
  it("rejects invalid page, bucket, and date values", () => {
    expect(() => ndrListQuery.parse({ page: 0 })).toThrow();
    expect(() => ndrListQuery.parse({ bucket: "RETURNED" })).toThrow();
    expect(() => ndrListQuery.parse({ from: "yesterday" })).toThrow();
    expect(ndrListQuery.parse({}).page).toBe(1);
    expect(ndrListQuery.parse({ q: "  " }).q).toBeUndefined();
  });
});

describe("istDayBounds", () => {
  it("uses the Asia/Kolkata calendar day", () => {
    const bounds = istDayBounds(new Date("2026-09-26T20:00:00.000Z"));
    expect(bounds.day).toBe("2026-09-27");
    expect(bounds.start).toBe("2026-09-26T18:30:00.000Z");
    expect(Date.parse(bounds.end) - Date.parse(bounds.start)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("NDR APIs", () => {
  it("counts summary cards inside the active organization", async () => {
    const orgs: string[] = [];
    const api = {
      select() {
        return api;
      },
      eq(column: string, value: string) {
        if (column === "organization_id") orgs.push(value);
        return api;
      },
      not() {
        return api;
      },
      in() {
        return api;
      },
      gte() {
        return api;
      },
      lt() {
        return api;
      },
      then(resolve: (value: { count: number; error: null }) => void) {
        resolve({ count: 4, error: null });
      },
    };
    const summary = await getNdrSummary({ from: () => api } as never, ctx);
    expect(summary.delivered).toBe(4);
    expect(summary.ndr).toBe(4);
    expect(summary.rtoDelivered).toBe(4);
    expect(orgs.length).toBe(7);
    expect(new Set(orgs)).toEqual(new Set(["org-a"]));
  });

  it("returns an empty page when the customer filter matches nobody in the tenant", async () => {
    const supabase = {
      from(table: string) {
        if (table !== "customers") throw new Error(`unexpected ${table}`);
        return {
          select: () => ({
            eq: () => ({
              or: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      },
    };
    const result = await listNdrShipments(supabase as never, ctx, ndrListQuery.parse({ customer: "Nobody" }));
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("does not load another tenant shipment and reports India Post failures", async () => {
    const filters: string[] = [];
    const supabase = {
      from(table: string) {
        const api = {
          select() {
            return api;
          },
          eq(column: string, value: string) {
            filters.push(`${table}.${column}:${value}`);
            return api;
          },
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return api;
      },
    };
    await expect(syncNdrShipment(supabase as never, ctx, "ship-b")).rejects.toMatchObject({
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
    });
    expect(filters).toContain("shipments.organization_id:org-a");
    expect(filters).toContain("shipments.id:ship-b");
    expect(indiaPostFromRow).not.toHaveBeenCalled();

    const connected = {
      from(table: string) {
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          maybeSingle: async () => ({
            data:
              table === "shipments"
                ? { id: "ship-a", barcode: "AW784699994IN", status: "IN_TRANSIT", order_id: "order-a", organization_id: "org-a" }
                : { status: "CONNECTED" },
            error: null,
          }),
        };
        return api;
      },
    };
    await expect(syncNdrShipment(connected as never, ctx, "ship-a")).rejects.toBeInstanceOf(AppError);
    await expect(syncNdrShipment(connected as never, ctx, "ship-a")).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_ERROR,
    });
  });
});
