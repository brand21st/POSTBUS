import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import {
  SHIPMENT_PRESET_MAX,
  createShipmentPreset,
  createShipmentPresetSchema,
  deleteShipmentPreset,
  shipmentPresetPackError,
} from "@/modules/shipments/presets";

const row = {
  id: "preset-1",
  user_id: "user-1",
  name: "Small box",
  weight_grams: 500,
  length_cm: 20,
  width_cm: 15,
  height_cm: 10,
  service_code: "SP_INLAND_PARCEL",
  created_at: "2026-10-08T00:00:00.000Z",
  updated_at: "2026-10-08T00:00:00.000Z",
  last_used_at: null,
};

function insertClient(options: {
  count?: number;
  existingNames?: string[];
  insertError?: { code?: string; message?: string } | null;
  inserted?: typeof row;
}) {
  const existing = (options.existingNames ?? Array.from({ length: options.count ?? 0 }, (_, i) => `Pack ${i + 1}`)).map(
    (name, i) => ({ id: `existing-${i}`, name })
  );
  const filters: Array<[string, unknown]> = [];
  return {
    filters,
    from(table: string) {
      if (table !== "user_shipment_presets") throw new Error(table);
      return {
        // Workspace-wide existing rows: cap and name are checked per organization only.
        select() {
          return {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return Promise.resolve({ data: existing, error: null });
            },
          };
        },
        insert() {
          return {
            select() {
              return {
                single() {
                  if (options.insertError) return Promise.resolve({ data: null, error: options.insertError });
                  return Promise.resolve({ data: options.inserted ?? row, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

function deleteClient(found: { id: string } | null) {
  return {
    from(table: string) {
      if (table !== "user_shipment_presets") throw new Error(table);
      return {
        delete() {
          return {
            eq() {
              return this;
            },
            select() {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: found, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("shipment presets", () => {
  it("rejects an undersized parcel before insert", () => {
    expect(createShipmentPresetSchema.safeParse({ name: "Tiny", weightGrams: 100, lengthCm: 5, widthCm: 15, heightCm: 10 }).success).toBe(
      false
    );
    expect(shipmentPresetPackError({ weightGrams: 100, lengthCm: 20, widthCm: 5, heightCm: 10 })).toMatch(/Width/);
  });

  it("saves a valid pack size", async () => {
    const created = await createShipmentPreset(insertClient({ count: 0 }) as never, "user-1", "org-1", {
      name: "Small box",
      weightGrams: 500,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
      serviceCode: "SP_INLAND_PARCEL",
    });
    expect(created).toMatchObject({
      id: "preset-1",
      name: "Small box",
      weightGrams: 500,
      serviceCode: "SP_INLAND_PARCEL",
    });
  });

  it("caps presets per workspace", async () => {
    await expect(
      createShipmentPreset(insertClient({ count: SHIPMENT_PRESET_MAX }) as never, "user-1", "org-1", {
        name: "Extra",
        weightGrams: 500,
        lengthCm: 20,
        widthCm: 15,
        heightCm: 10,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringMatching(/12/) });
  });

  it("rejects a duplicate name", async () => {
    await expect(
      createShipmentPreset(
        insertClient({ count: 1, insertError: { code: "23505", message: "user_shipment_presets_name_unique" } }) as never,
        "user-1",
        "org-1",
        { name: "Small box", weightGrams: 500, lengthCm: 20, widthCm: 15, heightCm: 10 }
      )
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      createShipmentPreset(
        insertClient({ count: 1, insertError: { code: "23505", message: "user_shipment_presets_name_unique" } }) as never,
        "user-1",
        "org-1",
        { name: "Small box", weightGrams: 500, lengthCm: 20, widthCm: 15, heightCm: 10 }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("checks the cap and names across the whole workspace, not per member", async () => {
    const client = insertClient({ existingNames: ["small BOX"] });
    await expect(
      createShipmentPreset(client as never, "user-2", "org-1", {
        name: "Small box",
        weightGrams: 500,
        lengthCm: 20,
        widthCm: 15,
        heightCm: 10,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(client.filters).toEqual([["organization_id", "org-1"]]);
  });

  it("maps the creating member", async () => {
    const created = await createShipmentPreset(insertClient({ count: 0 }) as never, "user-1", "org-1", {
      name: "Small box",
      weightGrams: 500,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
    });
    expect(created.createdBy).toBe("user-1");
  });

  it("does not delete a pack size from another workspace", async () => {
    await expect(deleteShipmentPreset(deleteClient(null) as never, "user-1", "org-1", "preset-other")).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });
});
