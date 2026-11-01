import { describe, expect, it } from "vitest";
import {
  classifyHistoricalOrganizationAddresses,
  ensureLegacyAddressValidation,
} from "@/modules/orders/historical-classify";

function client(
  rows: Array<Record<string, unknown>>,
  options?: { booked?: boolean; loseUpdate?: boolean; current?: Record<string, unknown> }
) {
  const updates: Array<{ table: string; values: unknown }> = [];
  return {
    updates,
    from(table: string) {
      const self: Record<string, unknown> = {};
      let didUpdate = false;
      let data: unknown = [];
      if (table === "addresses") data = rows;
      if (table === "orders") {
        data = rows.map((row) => ({ id: "ord-1", shipping_address_id: row.id }));
      }
      if (table === "shipments") {
        data = options?.booked ? [{ order_id: "ord-1", status: "BOOKED", booked_at: "2026-10-01" }] : [];
      }
      self.select = () => self;
      self.eq = () => self;
      self.is = () => self;
      self.in = () => self;
      self.limit = () => self;
      self.update = (values: unknown) => {
        didUpdate = true;
        updates.push({ table, values });
        return self;
      };
      self.maybeSingle = () => {
        if (table === "addresses" && didUpdate && options?.loseUpdate) {
          return Promise.resolve({ data: null, error: null });
        }
        if (table === "addresses" && didUpdate) {
          return Promise.resolve({ data: { ...rows[0], ...(updates.at(-1)?.values as object) }, error: null });
        }
        if (table === "addresses") {
          return Promise.resolve({ data: options?.current ?? rows[0] ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve, reject);
      return self;
    },
  };
}

const valid = {
  id: "addr-1",
  name: "Asha",
  phone: "9876543210",
  line1: "12 MG Road",
  city: "Kozhikode",
  state: "Kerala",
  pincode: "673001",
  country: "IN",
  address_validation_status: null,
};

describe("classifyHistoricalOrganizationAddresses", () => {
  it("dry-run classifies without writing street fields", async () => {
    const db = client([valid]);
    const result = await classifyHistoricalOrganizationAddresses(db as never, {
      organizationId: "org-1",
      dryRun: true,
    });
    expect(result.updated).toBe(0);
    expect(result.results[0]?.nextStatus).toBe("READY");
    expect(db.updates).toEqual([]);
  });

  it("writes only validation columns for unbooked rows", async () => {
    const db = client([valid]);
    const result = await classifyHistoricalOrganizationAddresses(db as never, {
      organizationId: "org-1",
      dryRun: false,
    });
    expect(result.updated).toBe(1);
    expect(db.updates[0]?.table).toBe("addresses");
    expect(db.updates[0]?.values).toEqual(
      expect.objectContaining({
        address_validation_status: "READY",
        address_normalization_source: "historical-classify",
      })
    );
    expect(db.updates[0]?.values).not.toHaveProperty("line1");
  });

  it("does not update booked shipment addresses", async () => {
    const db = client([valid], { booked: true });
    const result = await classifyHistoricalOrganizationAddresses(db as never, {
      organizationId: "org-1",
      dryRun: false,
    });
    expect(result.skippedBooked).toBe(1);
    expect(result.updated).toBe(0);
    expect(db.updates).toEqual([]);
  });
});

describe("ensureLegacyAddressValidation", () => {
  it("classifies NULL valid fields to READY without rewriting the street", async () => {
    const db = client([valid]);
    const next = await ensureLegacyAddressValidation(db as never, {
      organizationId: "org-1",
      address: valid,
    });
    expect(next.address_validation_status).toBe("READY");
    expect(db.updates[0]?.values).toEqual(
      expect.objectContaining({
        address_validation_status: "READY",
        address_normalization_source: "legacy-on-demand",
      })
    );
    expect(db.updates[0]?.values).not.toHaveProperty("line1");
    expect(db.updates[0]?.values).not.toHaveProperty("address_manual_override");
  });

  it("classifies NULL invalid PIN to INVALID and never READY", async () => {
    const db = client([{ ...valid, pincode: "12" }]);
    const next = await ensureLegacyAddressValidation(db as never, {
      organizationId: "org-1",
      address: { ...valid, pincode: "12" },
    });
    expect(next.address_validation_status).toBe("INVALID");
    expect(db.updates[0]?.values).toEqual(
      expect.objectContaining({ address_validation_status: "INVALID" })
    );
  });

  it("does not rewrite an already READY row", async () => {
    const db = client([{ ...valid, address_validation_status: "READY" }]);
    const next = await ensureLegacyAddressValidation(db as never, {
      organizationId: "org-1",
      address: { ...valid, address_validation_status: "READY" },
    });
    expect(next.address_validation_status).toBe("READY");
    expect(db.updates).toEqual([]);
  });

  it("throws when the address has no id so unpersisted READY cannot book", async () => {
    const db = client([valid]);
    await expect(
      ensureLegacyAddressValidation(db as never, {
        organizationId: "org-1",
        address: { ...valid, id: null },
      })
    ).rejects.toThrow("legacy-address-id-required");
    expect(db.updates).toEqual([]);
  });

  it("reloads the stored row when the snapshot no longer matches", async () => {
    const current = { ...valid, pincode: "000000", address_validation_status: null };
    const db = client([valid], { loseUpdate: true, current });
    const next = await ensureLegacyAddressValidation(db as never, {
      organizationId: "org-1",
      address: valid,
    });
    expect(next.pincode).toBe("000000");
    expect(next.address_validation_status).toBeNull();
  });
});
