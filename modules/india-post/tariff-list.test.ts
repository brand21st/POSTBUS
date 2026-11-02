import { describe, expect, it } from "vitest";
import { tariffEstimateKey } from "./tariff-contract";
import { tariffListState, type TariffListDefaults } from "./tariff-list";
import type { OrderRecord } from "@/types/api";

const defaults: TariffListDefaults = {
  service: "BUSINESS_PARCEL",
  sourcePincode: "400001",
  lengthCm: 20,
  widthCm: 15,
  heightCm: 10,
};

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    shippingAddress: { pincode: "110001" },
    lineItems: [{ id: "line-1", quantity: 2, weightGrams: 250 }],
    ...patch,
  };
}

describe("orders-list tariff readiness", () => {
  it("warns without weight and without dimensions", () => {
    expect(tariffListState(order({ lineItems: [] }), defaults)).toEqual({
      status: "missing",
      warning: "Add weight & size",
    });
    expect(tariffListState(order(), { ...defaults, lengthCm: undefined })).toEqual({
      status: "missing",
      warning: "Add weight & size",
    });
  });

  it("quotes a complete row and reuses a matching saved key", () => {
    const ready = tariffListState(order(), defaults);
    expect(ready.status).toBe("quote");
    if (ready.status !== "quote") throw new Error("expected quote state");
    expect(ready.input.weightGrams).toBe(500);
    expect(tariffListState(order({
      indiaPostEstimateAmount: 152,
      indiaPostEstimateKey: tariffEstimateKey(ready.input),
    }), defaults).status).toBe("saved");
  });

  it("quotes the resolved service when the shipment still names the other product", () => {
    const state = tariffListState(
      order({
        shipment: { id: "shipment-1", serviceCode: "SP_INLAND_PARCEL", service_code: "SP_INLAND_PARCEL" },
      }),
      defaults
    );
    expect(state.status).toBe("quote");
    if (state.status !== "quote") throw new Error("expected quote state");
    expect(state.input.service).toBe("BUSINESS_PARCEL");
  });

  it("quotes Speed Post when the order service is 500 g", () => {
    const state = tariffListState(order({ indiaPostService: "SP_INLAND_PARCEL" }), {
      ...defaults,
      service: undefined,
    });
    expect(state.status).toBe("quote");
    if (state.status !== "quote") throw new Error("expected quote state");
    expect(state.input.service).toBe("SP_INLAND_PARCEL");
  });

  it("requires a new quote after parcel data changes", () => {
    const first = tariffListState(order(), defaults);
    if (first.status !== "quote") throw new Error("expected quote state");
    const changed = tariffListState(order({
      lineItems: [{ id: "line-1", quantity: 3, weightGrams: 250 }],
      indiaPostEstimateAmount: 152,
      indiaPostEstimateKey: first.key,
    }), defaults);
    expect(changed.status).toBe("quote");
  });
});
