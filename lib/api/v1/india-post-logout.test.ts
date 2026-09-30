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

const LOGOUT_PATCH = {
  encrypted_username: null,
  encrypted_password: null,
  encrypted_access_token: null,
  encrypted_refresh_token: null,
  encrypted_id_token: null,
  expires_at: null,
  refresh_expires_at: null,
  last_refreshed_at: null,
  last_verified_at: null,
  bulk_customer_id: null,
  last_error: null,
  status: "NOT_CONNECTED",
  environment: "PRODUCTION",
};

function logoutDb(options: { connection: { id: string; organization_id: string } | null }) {
  const updates: Record<string, unknown>[] = [];
  const eqFilters: { column: string; value: unknown }[] = [];
  const audits: Record<string, unknown>[] = [];
  let lastTable = "";

  function chain(table: string, mode: "read" | "write", payload?: Record<string, unknown>) {
    const api = {
      select() {
        return api;
      },
      eq(column: string, value: unknown) {
        eqFilters.push({ column, value });
        return api;
      },
      async maybeSingle() {
        const orgFilter = eqFilters.find((item) => item.column === "organization_id");
        if (
          table === "india_post_connections" &&
          options.connection &&
          orgFilter?.value === options.connection.organization_id
        ) {
          return { data: { id: options.connection.id }, error: null };
        }
        return { data: null, error: null };
      },
      async single() {
        if (mode === "write" && table === "india_post_connections" && payload && options.connection) {
          const orgOk = eqFilters.some(
            (item) => item.column === "organization_id" && item.value === ctx.organizationId
          );
          const idOk = eqFilters.some((item) => item.column === "id" && item.value === options.connection?.id);
          if (orgOk && idOk) {
            updates.push(payload);
            return { data: { status: payload.status }, error: null };
          }
        }
        return { data: null, error: { message: "row not updated" } };
      },
    };
    return api;
  }

  return {
    updates,
    eqFilters,
    audits,
    client: {
      from(table: string) {
        lastTable = table;
        return {
          select() {
            return chain(table, "read");
          },
          update(payload: Record<string, unknown>) {
            return chain(table, "write", payload);
          },
          insert(payload: Record<string, unknown>) {
            if (lastTable === "audit_logs" || table === "audit_logs") {
              audits.push(payload);
            }
            return Promise.resolve({ data: payload, error: null });
          },
        };
      },
    },
  };
}

function del() {
  return new NextRequest("http://localhost/api/v1/integrations/india-post", { method: "DELETE" });
}

describe("DELETE integrations/india-post", () => {
  it("resets login and session columns for the tenant org only", async () => {
    const db = logoutDb({ connection: { id: "conn-1", organization_id: "org-1" } });
    const result = await handleIntegrationRoutes(
      del(),
      db.client as never,
      ctx,
      "DELETE integrations/india-post"
    );
    expect(result).toEqual({ loggedOut: true, status: "NOT_CONNECTED" });
    expect(db.updates).toEqual([LOGOUT_PATCH]);
    expect(db.eqFilters).toEqual(
      expect.arrayContaining([
        { column: "organization_id", value: "org-1" },
        { column: "id", value: "conn-1" },
      ])
    );
    expect(db.eqFilters.some((item) => item.column === "organization_id" && item.value !== "org-1")).toBe(
      false
    );
    expect(db.audits).toEqual([
      {
        organization_id: "org-1",
        actor_id: "user-1",
        action: "india_post.logged_out",
        entity_type: "india_post_connection",
        entity_id: "conn-1",
      },
    ]);
  });

  it("does not write a row belonging to another organization", async () => {
    const db = logoutDb({ connection: { id: "conn-other", organization_id: "org-other" } });
    const result = await handleIntegrationRoutes(
      del(),
      db.client as never,
      ctx,
      "DELETE integrations/india-post"
    );
    expect(result).toEqual({ loggedOut: true, status: "NOT_CONNECTED" });
    expect(db.updates).toEqual([]);
    expect(db.audits).toEqual([]);
  });

  it("is idempotent when this workspace has no connection row", async () => {
    const db = logoutDb({ connection: null });
    const result = await handleIntegrationRoutes(
      del(),
      db.client as never,
      ctx,
      "DELETE integrations/india-post"
    );
    expect(result).toEqual({ loggedOut: true, status: "NOT_CONNECTED" });
    expect(db.updates).toEqual([]);
  });
});
