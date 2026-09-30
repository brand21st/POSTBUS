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

function contractsDb(initial: { connected: boolean; contracts: ContractRow[] }) {
  let connected = initial.connected;
  let contracts = initial.contracts.map((row) => ({ ...row }));
  const deletes: string[] = [];
  const upserts: Record<string, unknown>[] = [];

  return {
    contracts: () => contracts,
    deletes,
    upserts,
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
                        data: connected
                          ? { id: "conn-1", booking_service_override: null }
                          : null,
                        error: null,
                      }),
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
            upsert(row: Record<string, unknown>) {
              upserts.push(row);
              const service = String(row.service_code);
              const next: ContractRow = {
                id: contracts.find((item) => item.service_code === service)?.id ?? `c-${service}`,
                organization_id: "org-1",
                service_code: service,
                contract_id: String(row.contract_id),
                is_default: Boolean(row.is_default),
                is_active: row.is_active !== false,
                label: String(row.label ?? ""),
              };
              const index = contracts.findIndex((item) => item.service_code === service);
              if (index >= 0) contracts[index] = next;
              else contracts.push(next);
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table === "shipments") {
          const chain = {
            select() {
              return chain;
            },
            update() {
              return chain;
            },
            eq() {
              return chain;
            },
            in() {
              return chain;
            },
            is() {
              return Promise.resolve({ data: [], error: null });
            },
          };
          return chain;
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
  };
}

function patch(serviceCode: string, contractId: string) {
  return new NextRequest("http://localhost/api/v1/integrations/india-post/contracts", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serviceCode, contractId }),
  });
}

describe("PATCH integrations/india-post/contracts", () => {
  it("upserts one contract id without requiring the other row", async () => {
    const db = contractsDb({
      connected: true,
      contracts: [
        {
          id: "c1",
          organization_id: "org-1",
          service_code: "BUSINESS_PARCEL",
          contract_id: "41793509",
          is_default: true,
          is_active: true,
          label: "Business Parcel",
        },
      ],
    });
    const result = (await handleIntegrationRoutes(
      patch("SP_INLAND_PARCEL", "41448820"),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/contracts"
    )) as { contracts: Array<{ serviceCode: string; contractId: string }> };
    expect(result.contracts.map((row) => [row.serviceCode, row.contractId])).toEqual([
      ["BUSINESS_PARCEL", "41793509"],
      ["SP_INLAND_PARCEL", "41448820"],
    ]);
    expect(db.upserts).toHaveLength(1);
  });

  it("deletes the row when the contract id is cleared and moves the default", async () => {
    const db = contractsDb({
      connected: true,
      contracts: [
        {
          id: "c1",
          organization_id: "org-1",
          service_code: "SP_INLAND_PARCEL",
          contract_id: "41448820",
          is_default: true,
          is_active: true,
          label: "Speed Post parcel",
        },
        {
          id: "c2",
          organization_id: "org-1",
          service_code: "BUSINESS_PARCEL",
          contract_id: "41793509",
          is_default: false,
          is_active: true,
          label: "Business Parcel",
        },
      ],
    });
    const result = (await handleIntegrationRoutes(
      patch("SP_INLAND_PARCEL", ""),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/contracts"
    )) as { defaultServiceCode: string; contracts: Array<{ serviceCode: string; isDefault: boolean }> };
    expect(db.deletes).toEqual(["SP_INLAND_PARCEL"]);
    expect(result.contracts.map((row) => row.serviceCode)).toEqual(["BUSINESS_PARCEL"]);
    expect(result.defaultServiceCode).toBe("BUSINESS_PARCEL");
    expect(result.contracts[0].isDefault).toBe(true);
  });

  it("rejects a short contract id", async () => {
    const db = contractsDb({ connected: true, contracts: [] });
    await expect(
      handleIntegrationRoutes(
        patch("BUSINESS_PARCEL", "12"),
        db.client as never,
        ctx,
        "PATCH integrations/india-post/contracts"
      )
    ).rejects.toBeInstanceOf(AppError);
    expect(db.upserts).toEqual([]);
  });

  it("asks for a saved connection before writing a contract id", async () => {
    const db = contractsDb({ connected: false, contracts: [] });
    await expect(
      handleIntegrationRoutes(
        patch("BUSINESS_PARCEL", "41793509"),
        db.client as never,
        ctx,
        "PATCH integrations/india-post/contracts"
      )
    ).rejects.toMatchObject({
      message: "Save your India Post customer ID and password first.",
    });
  });
});
