import { describe, expect, it } from "vitest";
import { addressProblem } from "@/components/shopify-app/address-modal";
import { bookableServices, bookingBlocker, bookingDefaults, parcelPayload } from "@/components/shopify-app/booking";
import { bulkBookingPending, bulkIssueLines } from "@/components/shopify-app/bulk-book-modal";
import {
  formatWeight,
  isShipmentActive,
  orderStatusBadge,
  paymentBadge,
  positiveNumber,
  shipmentStatusBadge,
} from "@/components/shopify-app/format";
import { isBookable, ordersQuery } from "@/components/shopify-app/orders-page";
import { setupChecklist } from "@/components/shopify-app/setup";
import type { IndiaPostSettings, OrderDetail } from "@/components/shopify-app/types";

function settings(overrides: Partial<IndiaPostSettings> = {}): IndiaPostSettings {
  return {
    status: "CONNECTED",
    environment: "PRODUCTION",
    hasPassword: true,
    contracts: [{ serviceCode: "SP_INLAND_PARCEL", contractId: "40012345", isDefault: true, isActive: true }],
    defaultServiceCode: "SP_INLAND_PARCEL",
    defaultLengthCm: 20,
    defaultWidthCm: 15,
    defaultHeightCm: 5,
    defaultWeightGrams: 500,
    ...overrides,
  };
}

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: "ord-1",
    orderNumber: "#1042",
    source: "SHOPIFY",
    status: "IMPORTED",
    paymentStatus: "COD",
    totalAmount: 1280,
    createdAt: "2026-10-22T10:00:00Z",
    customerName: "Asha Rao",
    items: 2,
    shipment: null,
    customer: { name: "Asha Rao" },
    shipping_address: { name: "Asha Rao", line1: "12 MG Road", city: "Mysuru", state: "Karnataka", pincode: "570001" },
    lineItems: [{ id: "li-1", title: "Saree", quantity: 2, weight_grams: 450 }],
    ...overrides,
  };
}

describe("status and payment badges", () => {
  it("follows the shipment once one exists", () => {
    expect(orderStatusBadge({ status: "IMPORTED", shipment: null })).toEqual({ label: "To book", tone: "caution" });
    expect(orderStatusBadge({ status: "IMPORTED", shipment: { status: "LABEL_READY" } }).label).toBe("Label ready");
    expect(orderStatusBadge({ status: "IMPORTED", shipment: { status: "CANCELLED" } }).label).toBe("To book");
    expect(shipmentStatusBadge("FAILED")).toEqual({ label: "Booking failed", tone: "critical" });
    expect(shipmentStatusBadge("SOMETHING_NEW").label).toBe("Something New");
  });

  it("labels COD and prepaid the way Indian merchants expect", () => {
    expect(paymentBadge("COD").label).toBe("COD");
    expect(paymentBadge("PENDING").label).toBe("COD");
    expect(paymentBadge("PAID").label).toBe("Prepaid");
  });

  it("treats only draft, failed and cancelled shipments as rebookable", () => {
    expect(isShipmentActive(null)).toBe(false);
    expect(isShipmentActive("FAILED")).toBe(false);
    expect(isShipmentActive("QUEUED")).toBe(true);
    expect(isShipmentActive("DELIVERED")).toBe(true);
  });

  it("formats weights and parses positive numbers", () => {
    expect(formatWeight(450)).toBe("450 g");
    expect(formatWeight(1500)).toBe("1.50 kg");
    expect(formatWeight(2000)).toBe("2 kg");
    expect(positiveNumber("")).toBeNull();
    expect(positiveNumber("-3")).toBeNull();
    expect(positiveNumber("12.5")).toBe(12.5);
  });
});

describe("setup checklist", () => {
  it("walks a new merchant through connect → contract → parcel → first shipment", () => {
    const fresh = setupChecklist(
      settings({ status: "NOT_CONNECTED", contracts: [], defaultWeightGrams: null }),
      0
    );
    expect(fresh.map((step) => step.done)).toEqual([false, false, false, false]);
    const ready = setupChecklist(settings(), 3);
    expect(ready.every((step) => step.done)).toBe(true);
  });
});

describe("booking form", () => {
  it("prefills from Shopify product weights, then workspace defaults", () => {
    expect(bookingDefaults(order(), settings())).toEqual({
      serviceCode: "SP_INLAND_PARCEL",
      weightGrams: "900",
      lengthCm: "20",
      widthCm: "15",
      heightCm: "5",
    });
    const noWeights = order({ lineItems: [{ id: "li-1", title: "Saree", quantity: 1, weight_grams: null }] });
    expect(bookingDefaults(noWeights, settings()).weightGrams).toBe("500");
  });

  it("only offers services that have a contract", () => {
    expect(bookableServices(settings()).map((option) => option.code)).toEqual(["SP_INLAND_PARCEL"]);
    const pinned = order({ indiaPostService: "BUSINESS_PARCEL" });
    expect(bookingDefaults(pinned, settings()).serviceCode).toBe("SP_INLAND_PARCEL");
  });

  it("validates the parcel before calling India Post", () => {
    const form = bookingDefaults(order(), settings());
    expect(parcelPayload(form)).toEqual({
      ok: true,
      value: { serviceCode: "SP_INLAND_PARCEL", weightGrams: 900, lengthCm: 20, widthCm: 15, heightCm: 5 },
    });
    expect(parcelPayload({ ...form, weightGrams: "" })).toMatchObject({ ok: false });
    expect(parcelPayload({ ...form, lengthCm: "151" })).toEqual({
      ok: false,
      error: "India Post accepts parcels up to 150 cm on each side.",
    });
  });

  it("explains why an order can't be booked", () => {
    expect(bookingBlocker(order(), settings())).toBeNull();
    expect(bookingBlocker(order(), settings({ status: "NOT_CONNECTED" }))?.href).toBe("/shopify/settings");
    expect(bookingBlocker(order(), settings({ contracts: [] }))?.href).toBe("/shopify/settings#contract");
    expect(bookingBlocker(order({ shipment: { id: "s", status: "BOOKED" } }), settings())?.message).toContain("already");
    expect(bookingBlocker(order({ shipment: { id: "s", status: "FAILED" } }), settings())).toBeNull();
    expect(bookingBlocker(order({ shipping_address: { pincode: "5700" } }), settings())?.message).toContain("PIN code");
  });
});

describe("orders list", () => {
  it("maps tabs and search to the orders query", () => {
    expect(ordersQuery("to-book", "", 1)).toBe("orders?page=1&pageSize=25&status=IMPORTED");
    expect(ordersQuery("all", " asha ", 2)).toBe("orders?page=2&pageSize=25&q=asha");
  });

  it("lets merchants select only orders that still need booking", () => {
    expect(isBookable(order())).toBe(true);
    expect(isBookable(order({ status: "CANCELLED" }))).toBe(false);
    expect(isBookable(order({ shipment: { id: "s", status: "QUEUED" } }))).toBe(false);
    expect(isBookable(order({ shipment: { id: "s", status: "FAILED" } }))).toBe(true);
  });
});

describe("bulk booking", () => {
  it("groups validation issues per order", () => {
    expect(
      bulkIssueLines({
        issues: [
          { orderNumber: "#1", field: "pincode", error: "Invalid PIN code" },
          { orderNumber: "#1", field: "weight", error: "Weight missing" },
          { orderNumber: "#1", field: "weight", error: "Weight missing" },
          { orderNumber: "#2", field: "phone", error: "Phone missing" },
        ],
      })
    ).toEqual(["#1: Invalid PIN code; Weight missing", "#2: Phone missing"]);
  });

  it("keeps polling while India Post is still working", () => {
    expect(bulkBookingPending({ queued: 1, processing: 0, retrying: 0 })).toBe(true);
    expect(bulkBookingPending({ queued: 0, processing: 0, retrying: 0 })).toBe(false);
  });
});

describe("address edit", () => {
  const base = { name: "Asha", phone: "+91 98765 43210", line1: "12 MG Road", line2: "", city: "Mysuru", state: "Karnataka", pincode: "570001" };
  it("accepts a valid Indian address with a +91 mobile", () => {
    expect(addressProblem(base)).toBeNull();
  });
  it("catches what India Post would reject", () => {
    expect(addressProblem({ ...base, pincode: "57001" })).toBe("PIN code must be 6 digits.");
    expect(addressProblem({ ...base, phone: "12345" })).toBe("Enter a 10-digit Indian mobile number.");
    expect(addressProblem({ ...base, city: "" })).toBe("Enter the city.");
  });
});
