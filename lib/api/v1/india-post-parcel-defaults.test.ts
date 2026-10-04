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
  permissions: ["org.manage"],
} as TenantContext;

function parcelDefaultsDb(initial: {
  length: number | null;
  width: number | null;
  height: number | null;
  weight: number | null;
}) {
  const state = {
    default_length_cm: initial.length,
    default_width_cm: initial.width,
    default_height_cm: initial.height,
    default_weight_grams: initial.weight,
  };
  const upserts: Record<string, unknown>[] = [];

  return {
    upserts,
    state,
    client: {
      from(table: string) {
        if (table !== "india_post_connections") throw new Error(`unexpected table ${table}`);
        return {
          upsert(payload: Record<string, unknown>) {
            upserts.push(payload);
            if ("default_length_cm" in payload) state.default_length_cm = (payload.default_length_cm as number | null) ?? null;
            if ("default_width_cm" in payload) state.default_width_cm = (payload.default_width_cm as number | null) ?? null;
            if ("default_height_cm" in payload) state.default_height_cm = (payload.default_height_cm as number | null) ?? null;
            if ("default_weight_grams" in payload) {
              state.default_weight_grams = (payload.default_weight_grams as number | null) ?? null;
            }
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
}

function patchDefaults(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/v1/integrations/india-post/parcel-defaults", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH integrations/india-post/parcel-defaults", () => {
  it("persists workspace default size and weight", async () => {
    const db = parcelDefaultsDb({ length: null, width: null, height: null, weight: null });
    const result = await handleIntegrationRoutes(
      patchDefaults({ lengthCm: 20, widthCm: 15, heightCm: 10, weightGrams: 500 }),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/parcel-defaults"
    );
    expect(result).toMatchObject({
      defaultLengthCm: 20,
      defaultWidthCm: 15,
      defaultHeightCm: 10,
      defaultWeightGrams: 500,
    });
    expect(db.upserts[0]).toMatchObject({
      organization_id: "org-1",
      default_length_cm: 20,
      default_width_cm: 15,
      default_height_cm: 10,
      default_weight_grams: 500,
    });
  });

  it("allows clearing defaults", async () => {
    const db = parcelDefaultsDb({ length: 20, width: 15, height: 10, weight: 500 });
    const result = await handleIntegrationRoutes(
      patchDefaults({ lengthCm: "", widthCm: null, heightCm: "", weightGrams: null }),
      db.client as never,
      ctx,
      "PATCH integrations/india-post/parcel-defaults"
    );
    expect(result).toMatchObject({
      defaultLengthCm: null,
      defaultWidthCm: null,
      defaultHeightCm: null,
      defaultWeightGrams: null,
    });
  });

  it("rejects out-of-range defaults", async () => {
    const db = parcelDefaultsDb({ length: null, width: null, height: null, weight: null });
    await expect(
      handleIntegrationRoutes(
        patchDefaults({ lengthCm: 10, widthCm: 15, heightCm: 10, weightGrams: 500 }),
        db.client as never,
        ctx,
        "PATCH integrations/india-post/parcel-defaults"
      )
    ).rejects.toBeInstanceOf(AppError);
  });
});
