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
