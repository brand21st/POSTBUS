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

function defaultServiceDb(initial: { contracts: ContractRow[]; override: string | null }) {
  let contracts = initial.contracts.map((row) => ({ ...row }));
  let override = initial.override;
  const connectionUpserts: Record<string, unknown>[] = [];

  return {
    connectionUpserts,
    contracts: () => contracts,
    override: () => override,
    client: {
      from(table: string) {
        if (table === "india_post_contracts") {
          return {
            select() {
              const chain = {
                eq() {
                  return chain;
                },
                order() {
                  return thenable({ data: contracts, error: null });
                },
                then(resolve: (value: { data: ContractRow[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
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
            update(payload: { is_default?: boolean }) {
              const chain = {
                eq(column: string, value: unknown) {
                  if (column === "is_default" && value === true && payload.is_default === false) {
                    contracts = contracts.map((row) => ({ ...row, is_default: false }));
                  }
                  return chain;
                },
                then(resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) {
                  return Promise.resolve({ error: null }).then(resolve, reject);
                },
              };
              return chain;
            },
            upsert(rows: Array<Record<string, unknown>>) {
              contracts = rows.map((row, index) => ({
                id: `c-${index}`,
                organization_id: "org-1",
                service_code: String(row.service_code),
                contract_id: String(row.contract_id),
                is_default: Boolean(row.is_default),
                is_active: row.is_active !== false,
                label: String(row.label ?? ""),
              }));
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table === "india_post_connections") {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: () =>
                      Promise.resolve({
                        data: { booking_service_override: override },
                        error: null,
                      }),
                  };
                },
              };
            },
            upsert(payload: Record<string, unknown>) {
              connectionUpserts.push(payload);
              if ("booking_service_override" in payload) {
                override = (payload.booking_service_override as string | null) ?? null;
              }
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table === "shipments") {
          const chain = {
            select() {
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

function patchDefault(serviceCode: string) {
  return new NextRequest("http://localhost/api/v1/integrations/india-post/default-service", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serviceCode }),
  });
}

describe("PATCH integrations/india-post/default-service", () => {
  it("marks the contract default and clears the topbar override", async () => {
    const db = defaultServiceDb({
      override: "SP_INLAND_PARCEL",
      contracts: [
        {
          id: "c1",
          organization_id: "org-1",
          service_code: "SP_INLAND_PARCEL",
          contract_id: "1111",
          is_default: true,
          is_active: true,
          label: "Speed Post parcel",
        },
        {
          id: "c2",
          organization_id: "org-1",
          service_code: "BUSINESS_PARCEL",
          contract_id: "2222",
          is_default: false,
          is_active: true,
          label: "Business Parcel",
        },
      ],
    });

    const result = await handleIntegrationRoutes(
      patchDefault("BUSINESS_PARCEL"),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/default-service"
    );

    expect(result).toEqual({
      defaultServiceCode: "BUSINESS_PARCEL",
      bookingServiceOverride: null,
    });
    expect(db.override()).toBeNull();
    expect(db.contracts().find((row) => row.is_default)?.service_code).toBe("BUSINESS_PARCEL");
    expect(db.connectionUpserts).toEqual([
      { organization_id: "org-1", booking_service_override: null },
    ]);
  });

  it("rejects a service with no saved contract", async () => {
    const db = defaultServiceDb({
      override: null,
      contracts: [
        {
          id: "c1",
          organization_id: "org-1",
          service_code: "SP_INLAND_PARCEL",
          contract_id: "1111",
          is_default: true,
          is_active: true,
          label: "Speed Post parcel",
        },
      ],
    });

    await expect(
      handleIntegrationRoutes(
        patchDefault("BUSINESS_PARCEL"),
        db.client as never,
        ctx,
        "PATCH integrations/india-post/default-service"
      )
    ).rejects.toBeInstanceOf(AppError);
    expect(db.connectionUpserts).toEqual([]);
  });
});
