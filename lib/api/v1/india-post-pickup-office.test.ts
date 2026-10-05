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

function pickupConnection(initial: string | null | "missing") {
  const state: {
    id: string;
    pickup_office_id: string | null;
    pickup_office_name: string | null;
    pickup_office_pincode: string | null;
    pickup_office_type_code: string | null;
    pickup_office_city: string | null;
    pickup_office_state: string | null;
  } | null =
    initial === "missing"
      ? null
      : {
          id: "conn-1",
          pickup_office_id: initial,
          pickup_office_name: "Kolenchery SO",
          pickup_office_pincode: "682311",
          pickup_office_type_code: "SO",
          pickup_office_city: "Ernakulam",
          pickup_office_state: "Kerala",
        };
  const updates: Record<string, unknown>[] = [];
  const eqs: Array<[string, unknown]> = [];

  function chain(mode: "read" | "write", payload?: Record<string, unknown>) {
    const api = {
      select() {
        return api;
      },
      eq(column: string, value: unknown) {
        eqs.push([column, value]);
        return api;
      },
      async maybeSingle() {
        return {
          data: state ? { id: state.id, pickup_office_id: state.pickup_office_id } : null,
          error: null,
        };
      },
      async single() {
        if (mode === "write" && state && payload) {
          updates.push(payload);
          for (const [key, value] of Object.entries(payload)) {
            (state as Record<string, unknown>)[key] = value;
          }
          return {
            data: {
              pickup_office_id: state.pickup_office_id,
              pickup_office_name: state.pickup_office_name,
              pickup_office_pincode: state.pickup_office_pincode,
              pickup_office_type_code: state.pickup_office_type_code,
              pickup_office_city: state.pickup_office_city,
              pickup_office_state: state.pickup_office_state,
            },
            error: null,
          };
        }
        return { data: null, error: { message: "missing connection" } };
      },
    };
    return api;
  }

  return {
    updates,
    eqs,
    client: {
      from() {
        return {
          select() {
            return chain("read");
          },
          update(payload: Record<string, unknown>) {
            return chain("write", payload);
          },
        };
      },
    },
  };
}

function patch(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/v1/integrations/india-post/pickup-office", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH integrations/india-post/pickup-office", () => {
  it("saves a pickup office on the tenant connection row", async () => {
    const db = pickupConnection(null);
    const result = await handleIntegrationRoutes(
      patch({
        pickupOfficeId: "21360043",
        pickupOfficeName: "Mysuru H.O",
        pickupOfficePincode: "570001",
        pickupOfficeTypeCode: "HPO",
        pickupOfficeCity: "MYSURU",
        pickupOfficeState: "Karnataka",
      }),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/pickup-office"
    );
    expect(result).toEqual({
      pickupOfficeId: "21360043",
      pickupOfficeName: "Mysuru H.O",
      pickupOfficePincode: "570001",
      pickupOfficeTypeCode: "HPO",
      pickupOfficeCity: "MYSURU",
      pickupOfficeState: "Karnataka",
    });
    expect(db.updates).toEqual([
      {
        pickup_office_id: "21360043",
        pickup_office_name: "Mysuru H.O",
        pickup_office_pincode: "570001",
        pickup_office_type_code: "HPO",
        pickup_office_city: "MYSURU",
        pickup_office_state: "Karnataka",
      },
    ]);
    expect(db.eqs).toContainEqual(["organization_id", "org-1"]);
  });

  it("updates an existing pickup office", async () => {
    const db = pickupConnection("22660454");
    const result = await handleIntegrationRoutes(
      patch({
        pickupOfficeId: "21360043",
        pickupOfficeName: "Mysuru H.O",
        pickupOfficePincode: "570001",
      }),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/pickup-office"
    );
    expect(result).toMatchObject({ pickupOfficeId: "21360043", pickupOfficeName: "Mysuru H.O" });
  });

  it("clears pickup office configuration", async () => {
    const db = pickupConnection("21360043");
    const result = await handleIntegrationRoutes(
      patch({ pickupOfficeId: null }),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/pickup-office"
    );
    expect(result).toEqual({
      pickupOfficeId: null,
      pickupOfficeName: null,
      pickupOfficePincode: null,
      pickupOfficeTypeCode: null,
      pickupOfficeCity: null,
      pickupOfficeState: null,
    });
  });

  it("rejects a missing office id that is not empty", async () => {
    const db = pickupConnection("21360043");
    await expect(
      handleIntegrationRoutes(
        patch({ pickupOfficeId: "2136" }),
        db.client as never,
        ctx,
        "PATCH integrations/india-post/pickup-office"
      )
    ).rejects.toBeInstanceOf(AppError);
    expect(db.updates).toEqual([]);
  });

  it("asks for a saved connection before writing pickup office", async () => {
    const db = pickupConnection("missing");
    await expect(
      handleIntegrationRoutes(
        patch({ pickupOfficeId: "21360043" }),
        db.client as never,
        ctx,
        "PATCH integrations/india-post/pickup-office"
      )
    ).rejects.toMatchObject({
      message: "Save your India Post customer ID and password first.",
    });
    expect(db.updates).toEqual([]);
  });

  it("scopes the write to the caller organization", async () => {
    const db = pickupConnection(null);
    await handleIntegrationRoutes(
      patch({ pickupOfficeId: "21360043", pickupOfficeName: "Mysuru H.O" }),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/pickup-office"
    );
    expect(db.eqs.filter(([column]) => column === "organization_id")).toEqual([
      ["organization_id", "org-1"],
      ["organization_id", "org-1"],
    ]);
  });
});

describe("GET integrations/india-post/offices", () => {
  it("rejects a short pincode", async () => {
    await expect(
      handleIntegrationRoutes(
        new NextRequest("http://localhost/api/v1/integrations/india-post/offices?pincode=57001"),
        {} as never,
        ctx,
        "GET integrations/india-post/offices"
      )
    ).rejects.toMatchObject({ message: "Enter a valid 6-digit pincode." });
  });

  it("rejects a non-numeric pincode", async () => {
    await expect(
      handleIntegrationRoutes(
        new NextRequest("http://localhost/api/v1/integrations/india-post/offices?pincode=ABC001"),
        {} as never,
        ctx,
        "GET integrations/india-post/offices"
      )
    ).rejects.toMatchObject({ message: "Enter a valid 6-digit pincode." });
  });
});
