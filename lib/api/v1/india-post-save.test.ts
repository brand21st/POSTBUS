import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/lib/api/context";
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

type ContractRow = {
  id: string;
  organization_id: string;
  service_code: string;
  contract_id: string;
  is_default: boolean;
  is_active: boolean;
  label: string;
};

function thenable<T>(value: T) {
  return {
    then(resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

type BarcodeRow = {
  next_number: number;
  prefix: string;
  suffix: string;
  start_number: number;
  end_number: number;
  service_code: string | null;
};

function saveDb(initial: ContractRow[], range?: BarcodeRow | null) {
  let contracts = initial.map((row) => ({ ...row }));
  const connectionUpserts: Record<string, unknown>[] = [];
  const connectionUpdates: Record<string, unknown>[] = [];
  const deletes: string[] = [];
  const barcodeInserts: Record<string, unknown>[] = [];
  let currentRange: BarcodeRow | null = range === undefined
    ? {
        next_number: 55697500,
        prefix: "CL",
        suffix: "IN",
        start_number: 55697399,
        end_number: 55697999,
        service_code: null,
      }
    : range;
  const connection = {
    id: "conn-1",
    organization_id: "org-1",
    status: "CONNECTED",
    environment: "PRODUCTION",
    bulk_customer_id: "1788590988",
  };

  function barcodeChain(kind: "select" | "update") {
    const obj = {
      eq() {
        return obj;
      },
      is() {
        return obj;
      },
      maybeSingle() {
        return Promise.resolve({ data: currentRange, error: null });
      },
      then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        if (kind === "update") currentRange = null;
        return Promise.resolve({ error: null }).then(resolve, reject);
      },
    };
    return obj;
  }

  return {
    connectionUpserts,
    connectionUpdates,
    deletes,
    barcodeInserts,
    contracts: () => contracts,
    client: {
      from(table: string) {
        if (table === "india_post_connections") {
          return {
            upsert(payload: Record<string, unknown>) {
              connectionUpserts.push(payload);
              Object.assign(connection, payload);
              return {
                select() {
                  return {
                    single: () => Promise.resolve({ data: { ...connection }, error: null }),
                  };
                },
              };
            },
            update(payload: Record<string, unknown>) {
              connectionUpdates.push(payload);
              return {
                eq() {
                  return {
                    select() {
                      return {
                        single: () => Promise.resolve({ data: { ...connection, ...payload }, error: null }),
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "india_post_contracts") {
          return {
            select() {
              const chain = {
                eq(column: string, value: unknown) {
                  if (column === "service_code") {
                    return {
                      maybeSingle: () =>
                        Promise.resolve({
                          data: contracts.find((row) => row.service_code === value) ?? null,
                          error: null,
                        }),
                    };
                  }
                  return chain;
                },
                order() {
                  return thenable({ data: contracts, error: null });
                },
                then(
                  resolve: (value: { data: ContractRow[]; error: null }) => unknown,
                  reject?: (reason: unknown) => unknown
                ) {
                  return Promise.resolve({ data: contracts, error: null }).then(resolve, reject);
                },
                maybeSingle() {
                  const def = contracts.find((row) => row.is_default && row.is_active);
                  return Promise.resolve({
                    data: def ? { service_code: def.service_code } : null,
                    error: null,
                  });
                },
              };
              return chain;
            },
            delete() {
              const filters: Record<string, unknown> = {};
              const chain = {
                eq(column: string, value: unknown) {
                  filters[column] = value;
                  if (filters.organization_id && filters.service_code) {
                    deletes.push(String(filters.service_code));
                    contracts = contracts.filter((row) => row.service_code !== filters.service_code);
                  }
                  return chain;
                },
                then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
                  return Promise.resolve({ error: null }).then(resolve, reject);
                },
              };
              return chain;
            },
            update(payload: { is_default?: boolean }) {
              const chain = {
                eq(column: string, value: unknown) {
                  if (column === "is_default" && value === true && payload.is_default === false) {
                    contracts = contracts.map((row) => ({ ...row, is_default: false }));
                  }
                  if (column === "service_code" && payload.is_default === true) {
                    contracts = contracts.map((row) => ({
                      ...row,
                      is_default: row.service_code === value,
                    }));
                  }
                  return chain;
                },
                then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
                  return Promise.resolve({ error: null }).then(resolve, reject);
                },
              };
              return chain;
            },
            upsert(row: Record<string, unknown> | Record<string, unknown>[]) {
              const rows = Array.isArray(row) ? row : [row];
              for (const item of rows) {
                const service = String(item.service_code);
                const next: ContractRow = {
                  id: contracts.find((c) => c.service_code === service)?.id ?? `c-${service}`,
                  organization_id: "org-1",
                  service_code: service,
                  contract_id: String(item.contract_id),
                  is_default: Boolean(item.is_default),
                  is_active: item.is_active !== false,
                  label: String(item.label ?? ""),
                };
                const index = contracts.findIndex((c) => c.service_code === service);
                if (index >= 0) contracts[index] = next;
                else contracts.push(next);
              }
              return Promise.resolve({ error: null });
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
              barcodeInserts.push(row);
              currentRange = {
                next_number: Number(row.next_number),
                prefix: String(row.prefix),
                suffix: String(row.suffix),
                start_number: Number(row.start_number),
                end_number: Number(row.end_number),
                service_code: (row.service_code as string | null) ?? null,
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

describe("POST integrations/india-post connect:false", () => {
  it("saves settings without logging in or setting PENDING", async () => {
    const db = saveDb([
      {
        id: "c1",
        organization_id: "org-1",
        service_code: "SP_INLAND_PARCEL",
        contract_id: "41448820",
        is_default: false,
        is_active: true,
        label: "Speed Post parcel",
      },
      {
        id: "c2",
        organization_id: "org-1",
        service_code: "BUSINESS_PARCEL",
        contract_id: "41793509",
        is_default: true,
        is_active: true,
        label: "Business Parcel",
      },
    ]);
    const request = new NextRequest("http://localhost/api/v1/integrations/india-post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connect: false,
        environment: "PRODUCTION",
        bulkCustomerId: "1788590988",
        pickupDropoffOfficeId: "22660454",
        contracts: [
          { serviceCode: "SP_INLAND_PARCEL", contractId: "", isDefault: false },
          { serviceCode: "BUSINESS_PARCEL", contractId: "41793509", isDefault: true },
        ],
      }),
    });
    const result = await handleIntegrationRoutes(
      request,
      db.client as never,
      ctx,
      "POST integrations/india-post"
    );
    expect(result).toEqual({ saved: true, status: "CONNECTED" });
    expect(db.connectionUpserts[0]).not.toHaveProperty("status");
    expect(db.connectionUpserts[0]).toMatchObject({ pickup_dropoff_office_id: "22660454" });
    expect(db.connectionUpdates.some((row) => "encrypted_access_token" in row)).toBe(false);
    expect(db.deletes).toContain("SP_INLAND_PARCEL");
    expect(db.contracts().map((row) => row.service_code)).toEqual(["BUSINESS_PARCEL"]);
  });

  it("clears the drop-off office when the office id is empty", async () => {
    const db = saveDb([]);
    const request = new NextRequest("http://localhost/api/v1/integrations/india-post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connect: false,
        environment: "PRODUCTION",
        bulkCustomerId: "1788590988",
        pickupDropoffOfficeId: "",
        pickupDropoffOfficeName: "",
      }),
    });
    await handleIntegrationRoutes(request, db.client as never, ctx, "POST integrations/india-post");
    expect(db.connectionUpserts[0]).toMatchObject({
      pickup_dropoff_office_id: null,
      pickup_dropoff_office_name: null,
    });
  });

  it("does not rewrite an unchanged barcode series", async () => {
    const db = saveDb([]);
    const request = new NextRequest("http://localhost/api/v1/integrations/india-post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connect: false,
        environment: "PRODUCTION",
        bulkCustomerId: "1788590988",
        barcodeRange: {
          prefix: "CL",
          suffix: "IN",
          startNumber: 55697399,
          endNumber: 55697999,
          serviceCode: null,
        },
      }),
    });
    const result = await handleIntegrationRoutes(
      request,
      db.client as never,
      ctx,
      "POST integrations/india-post"
    );
    expect(result).toEqual({ saved: true, status: "CONNECTED" });
    expect(db.barcodeInserts).toEqual([]);
  });

  it("stores the 8-digit serial when the range is pasted as 13-character articles", async () => {
    const db = saveDb([], null);
    const request = new NextRequest("http://localhost/api/v1/integrations/india-post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connect: false,
        environment: "PRODUCTION",
        bulkCustomerId: "1788590988",
        barcodeRange: {
          prefix: "CL",
          suffix: "IN",
          startNumber: "CL556973995IN",
          endNumber: "CL556979998IN",
          serviceCode: null,
        },
      }),
    });
    await handleIntegrationRoutes(
      request,
      db.client as never,
      ctx,
      "POST integrations/india-post"
    );
    expect(db.barcodeInserts[0]).toMatchObject({
      prefix: "CL",
      suffix: "IN",
      start_number: 55697399,
      end_number: 55697999,
      next_number: 55697399,
    });
  });

  it("keeps next_number when the end of the same series is extended", async () => {
    const db = saveDb([]);
    const request = new NextRequest("http://localhost/api/v1/integrations/india-post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connect: false,
        environment: "PRODUCTION",
        bulkCustomerId: "1788590988",
        barcodeRange: {
          prefix: "CL",
          suffix: "IN",
          startNumber: 55697399,
          endNumber: 55698999,
          serviceCode: null,
        },
      }),
    });
    await handleIntegrationRoutes(
      request,
      db.client as never,
      ctx,
      "POST integrations/india-post"
    );
    expect(db.barcodeInserts[0]?.next_number).toBe(55697500);
    expect(db.barcodeInserts[0]?.end_number).toBe(55698999);
  });
});
