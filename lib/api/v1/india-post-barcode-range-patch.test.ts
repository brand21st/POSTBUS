import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { AppError } from "@/lib/api/errors";
import { handleIntegrationRoutes } from "@/lib/api/v1/integrations";

const ctx = {
  userId: "user-1",
  email: "owner@example.com",
  fullName: "Owner",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "OWNER",
  permissions: ["integrations.manage"],
} as TenantContext;

type RangeRow = {
  prefix: string;
  suffix: string;
  start_number: number;
  end_number: number;
  next_number: number;
  service_code: string | null;
  is_active: boolean;
};

function thenable<T>(value: T) {
  return {
    then(resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function rangeDb(options: { connected: boolean; range: RangeRow | null }) {
  const connected = options.connected;
  let range = options.range ? { ...options.range } : null;
  const inserts: Record<string, unknown>[] = [];
  let retires = 0;

  function barcodeChain(kind: "select" | "update") {
    const obj = {
      eq() {
        return obj;
      },
      is() {
        return obj;
      },
      maybeSingle() {
        return Promise.resolve({
          data: range?.is_active ? range : null,
          error: null,
        });
      },
      order() {
        return thenable({
          data: range?.is_active ? [range] : [],
          error: null,
        });
      },
      then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        if (kind === "update") {
          retires += 1;
          if (range) range = { ...range, is_active: false };
        }
        return Promise.resolve({ error: null }).then(resolve, reject);
      },
    };
    return obj;
  }

  return {
    inserts,
    retires: () => retires,
    range: () => range,
    client: {
      from(table: string) {
        if (table === "india_post_connections") {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: () =>
                      Promise.resolve({
                        data: connected ? { id: "conn-1", environment: "PRODUCTION" } : null,
                        error: null,
                      }),
                  };
                },
              };
            },
          };
        }
        if (table === "barcode_ranges") {
          return {
            select() {
              return barcodeChain("select");
            },
            update() {
              return barcodeChain("update");
            },
            insert(row: Record<string, unknown>) {
              inserts.push(row);
              range = {
                prefix: String(row.prefix),
                suffix: String(row.suffix),
                start_number: Number(row.start_number),
                end_number: Number(row.end_number),
                next_number: Number(row.next_number),
                service_code: (row.service_code as string | null) ?? null,
                is_active: true,
              };
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
  };
}

function rangesDb(options: { connected: boolean; ranges: RangeRow[] }) {
  const connected = options.connected;
  let ranges = options.ranges.map((row) => ({ ...row }));
  const inserts: Record<string, unknown>[] = [];

  function matches(row: RangeRow, filters: { column: string; value: unknown }[]) {
    return filters.every((filter) => {
      if (filter.column === "organization_id") return true;
      if (filter.column === "is_active") return row.is_active === filter.value;
      if (filter.column === "service_code") return row.service_code === filter.value;
      if (filter.column === "prefix") return row.prefix === filter.value;
      return true;
    });
  }

  function barcodeChain(kind: "select" | "update") {
    const filters: { column: string; value: unknown }[] = [];
    const obj = {
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        return obj;
      },
      is(column: string, value: unknown) {
        filters.push({ column, value });
        return obj;
      },
      maybeSingle() {
        const found = ranges.filter((row) => matches(row, filters));
        return Promise.resolve({ data: found[0] ?? null, error: null });
      },
      order() {
        return thenable({
          data: ranges.filter((row) => matches(row, filters)),
          error: null,
        });
      },
      then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        if (kind === "update") {
          ranges = ranges.map((row) => (matches(row, filters) ? { ...row, is_active: false } : row));
        }
        return Promise.resolve({ error: null }).then(resolve, reject);
      },
    };
    return obj;
  }

  return {
    inserts,
    active: () => ranges.filter((row) => row.is_active),
    client: {
      from(table: string) {
        if (table === "india_post_connections") {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: () =>
                      Promise.resolve({
                        data: connected ? { id: "conn-1", environment: "PRODUCTION" } : null,
                        error: null,
                      }),
                  };
                },
              };
            },
          };
        }
        if (table === "barcode_ranges") {
          return {
            select() {
              return barcodeChain("select");
            },
            update() {
              return barcodeChain("update");
            },
            insert(row: Record<string, unknown>) {
              inserts.push(row);
              ranges.push({
                prefix: String(row.prefix),
                suffix: String(row.suffix),
                start_number: Number(row.start_number),
                end_number: Number(row.end_number),
                next_number: Number(row.next_number),
                service_code: (row.service_code as string | null) ?? null,
                is_active: true,
              });
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
  };
}

function patch(body: unknown) {
  return new NextRequest("http://localhost/api/v1/integrations/india-post/barcode-range", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const existingRange: RangeRow = {
  prefix: "EY",
  suffix: "IN",
  start_number: 59288875,
  end_number: 59289874,
  next_number: 59288875,
  service_code: null,
  is_active: true,
};

describe("PATCH integrations/india-post/barcode-range", () => {
  it("clears the saved series from the database", async () => {
    const db = rangeDb({ connected: true, range: existingRange });
    const result = await handleIntegrationRoutes(
      patch({ barcodeRange: null }),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/barcode-range"
    );
    expect(result).toEqual({ barcodeRange: null, barcodeRanges: [] });
    expect(db.retires()).toBeGreaterThan(0);
    expect(db.range()?.is_active).toBe(false);
    expect(db.inserts).toEqual([]);
  });

  it("saves a new series", async () => {
    const db = rangeDb({ connected: true, range: null });
    const result = await handleIntegrationRoutes(
      patch({
        barcodeRange: {
          prefix: "EY",
          suffix: "IN",
          startNumber: "592888756",
          endNumber: "592898740",
          serviceCode: null,
        },
      }),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/barcode-range"
    );
    expect(db.inserts[0]).toMatchObject({
      prefix: "EY",
      start_number: 59288875,
      end_number: 59289874,
    });
    expect(result).toMatchObject({
      barcodeRange: { prefix: "EY", startNumber: 59288875, endNumber: 59289874 },
    });
  });

  it("saves a Speed Post series without retiring Business Parcel", async () => {
    const db = rangesDb({
      connected: true,
      ranges: [
        {
          prefix: "CL",
          suffix: "IN",
          start_number: 55697399,
          end_number: 55697999,
          next_number: 55697399,
          service_code: "SP_INLAND_PARCEL",
          is_active: true,
        },
        {
          prefix: "CX",
          suffix: "IN",
          start_number: 7525051,
          end_number: 7526050,
          next_number: 7525051,
          service_code: "BUSINESS_PARCEL",
          is_active: true,
        },
      ],
    });
    await handleIntegrationRoutes(
      patch({
        barcodeRange: {
          prefix: "EY",
          suffix: "IN",
          startNumber: 59288875,
          endNumber: 59289874,
          serviceCode: "SP_INLAND_PARCEL",
        },
        serviceCode: "SP_INLAND_PARCEL",
      }),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/barcode-range"
    );
    const active = db.active();
    expect(active.find((row) => row.service_code === "BUSINESS_PARCEL")).toMatchObject({
      prefix: "CX",
      is_active: true,
    });
    expect(active.find((row) => row.service_code === "SP_INLAND_PARCEL")).toMatchObject({
      prefix: "EY",
      start_number: 59288875,
      end_number: 59289874,
    });
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toMatchObject({ service_code: "SP_INLAND_PARCEL", prefix: "EY" });
  });

  it("retires a shared series with the same prefix", async () => {
    const db = rangesDb({
      connected: true,
      ranges: [
        {
          prefix: "EY",
          suffix: "IN",
          start_number: 100,
          end_number: 200,
          next_number: 100,
          service_code: null,
          is_active: true,
        },
      ],
    });
    await handleIntegrationRoutes(
      patch({
        barcodeRange: {
          prefix: "EY",
          suffix: "IN",
          startNumber: 59288875,
          endNumber: 59289874,
          serviceCode: "SP_INLAND_PARCEL",
        },
        serviceCode: "SP_INLAND_PARCEL",
      }),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/barcode-range"
    );
    const active = db.active();
    expect(active.find((row) => row.service_code === null)).toBeUndefined();
    expect(active.find((row) => row.service_code === "SP_INLAND_PARCEL")).toMatchObject({
      prefix: "EY",
      is_active: true,
    });
  });

  it("leaves a shared series with a different prefix active", async () => {
    const db = rangesDb({
      connected: true,
      ranges: [
        {
          prefix: "CL",
          suffix: "IN",
          start_number: 300,
          end_number: 400,
          next_number: 300,
          service_code: null,
          is_active: true,
        },
      ],
    });
    await handleIntegrationRoutes(
      patch({
        barcodeRange: {
          prefix: "ET",
          suffix: "IN",
          startNumber: 59288875,
          endNumber: 59289874,
          serviceCode: "BUSINESS_PARCEL",
        },
        serviceCode: "BUSINESS_PARCEL",
      }),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/barcode-range"
    );
    const active = db.active();
    expect(active.find((row) => row.service_code === null)).toMatchObject({ prefix: "CL", is_active: true });
    expect(active.find((row) => row.service_code === "BUSINESS_PARCEL")).toMatchObject({ prefix: "ET" });
  });

  it("clears one service series without retiring the other", async () => {
    const db = rangesDb({
      connected: true,
      ranges: [
        {
          prefix: "CL",
          suffix: "IN",
          start_number: 55697399,
          end_number: 55697999,
          next_number: 55697399,
          service_code: "SP_INLAND_PARCEL",
          is_active: true,
        },
        {
          prefix: "CX",
          suffix: "IN",
          start_number: 7525051,
          end_number: 7526050,
          next_number: 7525051,
          service_code: "BUSINESS_PARCEL",
          is_active: true,
        },
      ],
    });
    const result = await handleIntegrationRoutes(
      patch({ barcodeRange: null, serviceCode: "SP_INLAND_PARCEL", prefix: "CL" }),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/barcode-range"
    );
    expect(db.active().map((row) => row.service_code)).toEqual(["BUSINESS_PARCEL"]);
    expect(result).toMatchObject({
      barcodeRanges: [{ prefix: "CX", serviceCode: "BUSINESS_PARCEL" }],
    });
  });

  it("requires a saved India Post login", async () => {
    const db = rangeDb({ connected: false, range: null });
    await expect(
      handleIntegrationRoutes(
        patch({ barcodeRange: null }),
        db.client as never,
        ctx,
        "PATCH integrations/india-post/barcode-range"
      )
    ).rejects.toBeInstanceOf(AppError);
  });
});
