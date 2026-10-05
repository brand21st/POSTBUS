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

function officeConnection(initial: string | null | "missing") {
  const state: {
    id: string;
    pickup_dropoff_office_id: string | null;
    pickup_dropoff_office_name: string | null;
  } | null =
    initial === "missing"
      ? null
      : { id: "conn-1", pickup_dropoff_office_id: initial, pickup_dropoff_office_name: "Kolenchery SO" };
  const updates: Record<string, unknown>[] = [];

  function chain(mode: "read" | "write", payload?: Record<string, unknown>) {
    const api = {
      select() {
        return api;
      },
      eq() {
        return api;
      },
      async maybeSingle() {
        return {
          data: state
            ? { id: state.id, pickup_dropoff_office_id: state.pickup_dropoff_office_id }
            : null,
          error: null,
        };
      },
      async single() {
        if (mode === "write" && state && payload) {
          updates.push(payload);
          if ("pickup_dropoff_office_id" in payload) {
            state.pickup_dropoff_office_id = (payload.pickup_dropoff_office_id as string | null) ?? null;
          }
          if ("pickup_dropoff_office_name" in payload) {
            state.pickup_dropoff_office_name = (payload.pickup_dropoff_office_name as string | null) ?? null;
          }
          return {
            data: {
              pickup_dropoff_office_id: state.pickup_dropoff_office_id,
              pickup_dropoff_office_name: state.pickup_dropoff_office_name,
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

function patch(officeId: string | null, officeName?: string | null) {
  return new NextRequest("http://localhost/api/v1/integrations/india-post/office", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      officeName === undefined
        ? { pickupDropoffOfficeId: officeId }
        : { pickupDropoffOfficeId: officeId, pickupDropoffOfficeName: officeName }
    ),
  });
}

describe("PATCH integrations/india-post/office", () => {
  it("saves office id 22360042 on the connection row", async () => {
    const db = officeConnection(null);
    const result = await handleIntegrationRoutes(
      patch("22360042", "Manjerikla HO"),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/office"
    );
    expect(result).toEqual({
      pickupDropoffOfficeId: "22360042",
      pickupDropoffOfficeName: "Manjerikla HO",
    });
    expect(db.updates).toEqual([
      { pickup_dropoff_office_id: "22360042", pickup_dropoff_office_name: "Manjerikla HO" },
    ]);
  });

  it("updates only the office id column", async () => {
    const db = officeConnection("22660454");
    const result = await handleIntegrationRoutes(
      patch("12345678"),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/office"
    );
    expect(result).toEqual({ pickupDropoffOfficeId: "12345678", pickupDropoffOfficeName: null });
    expect(db.updates).toEqual([
      { pickup_dropoff_office_id: "12345678", pickup_dropoff_office_name: null },
    ]);
  });

  it("clears the office id when the field is empty", async () => {
    const db = officeConnection("22360042");
    const result = await handleIntegrationRoutes(
      patch(""),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/office"
    );
    expect(result).toEqual({ pickupDropoffOfficeId: null, pickupDropoffOfficeName: null });
    expect(db.updates).toEqual([
      { pickup_dropoff_office_id: null, pickup_dropoff_office_name: null },
    ]);
  });

  it("clears the office id when the client sends null", async () => {
    const db = officeConnection("22360042");
    const result = await handleIntegrationRoutes(
      patch(null, null),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/office"
    );
    expect(result).toEqual({ pickupDropoffOfficeId: null, pickupDropoffOfficeName: null });
    expect(db.updates).toEqual([
      { pickup_dropoff_office_id: null, pickup_dropoff_office_name: null },
    ]);
  });

  it("rejects a short office id and leaves the row unchanged", async () => {
    const db = officeConnection("22660454");
    await expect(
      handleIntegrationRoutes(patch("1234"), db.client as never, ctx, "PATCH integrations/india-post/office")
    ).rejects.toBeInstanceOf(AppError);
    expect(db.updates).toEqual([]);
  });

  it("asks for a saved connection before writing an office id", async () => {
    const db = officeConnection("missing");
    await expect(
      handleIntegrationRoutes(patch("12345678"), db.client as never, ctx, "PATCH integrations/india-post/office")
    ).rejects.toMatchObject({
      message: "Save your India Post customer ID and password first.",
    });
    expect(db.updates).toEqual([]);
  });

  it("saves the post office name with the office id", async () => {
    const db = officeConnection("22660454");
    const result = await handleIntegrationRoutes(
      patch("22660454", "Kolenchery SO"),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/office"
    );
    expect(result).toEqual({
      pickupDropoffOfficeId: "22660454",
      pickupDropoffOfficeName: "Kolenchery SO",
    });
    expect(db.updates).toEqual([
      { pickup_dropoff_office_id: "22660454", pickup_dropoff_office_name: "Kolenchery SO" },
    ]);
  });
});
