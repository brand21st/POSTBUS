import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SHOPIFY_ADDRESS_WRITE_COLUMNS,
  classifyStoredShippingAddress,
  incomingShopifyShippingUnusable,
  shopifyAddressPersistence,
  shopifyMayRefreshStoredAddress,
  shippingAddressBookingBlock,
  normalizeShopifyShipping,
} from "@/modules/shopify/shipping-contact";

const readyRow = {
  name: "Rahul K",
  phone: "9876543210",
  original_phone: "9876543210",
  phone_source: "shipping",
  line1: "10B, Rose Villa",
  line2: "Near Bus Stand",
  line3: "",
  city: "Kozhikode",
  state: "Kerala",
  pincode: "673001",
  country: "IN",
  address_validation_status: "READY" as const,
};

describe("P0-07 fail-closed booking eligibility", () => {
  it("allows READY only when live fields still pass", () => {
    expect(shippingAddressBookingBlock(readyRow)).toBeNull();
  });

  it("blocks READY that no longer matches the stored fields", () => {
    expect(
      shippingAddressBookingBlock({
        ...readyRow,
        phone: "0000000000",
      })
    ).toMatch(/Invalid/i);
  });

  it("blocks NEEDS_REVIEW, INVALID, NULL, unknown, and missing addresses", () => {
    expect(shippingAddressBookingBlock({ ...readyRow, address_validation_status: "NEEDS_REVIEW" })).toBeTruthy();
    expect(shippingAddressBookingBlock({ ...readyRow, address_validation_status: "INVALID" })).toBeTruthy();
    expect(shippingAddressBookingBlock({ ...readyRow, address_validation_status: null })).toMatch(/not been validated/i);
    expect(shippingAddressBookingBlock({ ...readyRow, address_validation_status: "UNKNOWN" })).toMatch(/incomplete/i);
    expect(shippingAddressBookingBlock(null)).toMatch(/Missing shipping address/i);
  });

  it("blocks a legacy NULL status even when the phone looks like a placeholder", () => {
    expect(
      shippingAddressBookingBlock({
        ...readyRow,
        phone: "0000000000",
        address_validation_status: null,
      })
    ).toBeTruthy();
  });
});

describe("P0-02 Shopify refresh protection", () => {
  it("protects unknown legacy rows and merchant overrides", () => {
    expect(shopifyMayRefreshStoredAddress({ address_manual_override: null, original_shipping: null })).toBe(false);
    expect(
      shopifyMayRefreshStoredAddress({
        address_manual_override: true,
        original_shipping: { address1: "x" },
      })
    ).toBe(false);
    expect(shopifyMayRefreshStoredAddress({ address_manual_override: false, original_shipping: null })).toBe(false);
  });

  it("allows a new Shopify-managed import with an original snapshot", () => {
    expect(
      shopifyMayRefreshStoredAddress({
        address_manual_override: false,
        original_shipping: { address1: "12 MG Road" },
      })
    ).toBe(true);
  });

  it("refuses an empty incoming payload over populated storage", () => {
    expect(
      incomingShopifyShippingUnusable({
        line1: "",
        city: "",
        pincode: "",
        name: "",
        phone: "",
      })
    ).toBe(true);
  });
});

describe("P0-08 schema write contract", () => {
  it("persists every new address-normalization column", () => {
    const contact = normalizeShopifyShipping({
      shipping_address: {
        first_name: "Rahul",
        last_name: "K",
        phone: "9876543210",
        address1: "10B",
        city: "Kozhikode",
        province: "Kerala",
        zip: "673001",
        country_code: "IN",
      },
    });
    const row = shopifyAddressPersistence(contact);
    for (const column of SHOPIFY_ADDRESS_WRITE_COLUMNS) {
      expect(row).toHaveProperty(column);
    }
    expect(row.address_manual_override).toBe(false);
  });
});

describe("P0-04 barcode allocation order", () => {
  it("checks the address gate before allocateNextBarcode in booking-run", () => {
    const source = readFileSync(new URL("./../india-post/booking-run.ts", import.meta.url), "utf8");
    const pending = source.slice(source.indexOf("for (const shipment of pending)"));
    expect(pending.indexOf("shippingAddressBookingBlock")).toBeGreaterThan(-1);
    expect(pending.indexOf("shippingAddressBookingBlock")).toBeLessThan(pending.indexOf("allocateNextBarcode"));
  });
});

describe("classifyStoredShippingAddress", () => {
  it("keeps Malayalam text and does not invent a PIN", () => {
    const classified = classifyStoredShippingAddress({
      name: "രാഹുൽ",
      phone: "9876543210",
      line1: "റോസ് വില്ല, കൽപ്പറ്റ",
      city: "Kalpetta",
      state: "Kerala",
      pincode: "",
      country: "IN",
    });
    expect(classified.status).toBe("INVALID");
    expect(classified.issues.some((issue) => issue.code === "missing_pincode")).toBe(true);
  });
});
