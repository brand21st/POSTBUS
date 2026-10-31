import { describe, expect, it } from "vitest";
import { shippingAddressBookingBlock, type StoredShippingFields } from "@/modules/shopify/shipping-contact";

const valid: StoredShippingFields = {
  name: "Asha Kumar",
  phone: "9876543210",
  phone_source: "shipping",
  line1: "12 Market Road",
  line2: "T Nagar",
  city: "Chennai",
  state: "Tamil Nadu",
  pincode: "600017",
  country: "IN",
  address_validation_status: "READY",
};

describe("shipping address booking gate", () => {
  it("allows a complete READY address for manual, Shopify, Excel, and bulk rows", () => {
    expect(shippingAddressBookingBlock(valid)).toBeNull();
    expect(shippingAddressBookingBlock({ ...valid, line2: undefined })).toBeNull();
    const { address_validation_status: _status, ...withoutStoredStatus } = valid;
    expect(shippingAddressBookingBlock(withoutStoredStatus)).toBeNull();
  });

  it("allows a previously validated READY address that still matches India Post rules", () => {
    expect(
      shippingAddressBookingBlock({
        ...valid,
        address_normalization_source: "legacy-on-demand",
      })
    ).toBeNull();
  });

  it("uses the latest saved address fields for booking, not a stale PIN", () => {
    const stale = { ...valid, pincode: "12" };
    const saved = { ...valid, pincode: "600017" };
    expect(shippingAddressBookingBlock(stale)).toMatch(/PIN code/i);
    expect(shippingAddressBookingBlock(saved)).toBeNull();
  });

  it("blocks an incomplete PIN without skipping India Post checks", () => {
    expect(shippingAddressBookingBlock({ ...valid, pincode: "12" })).toMatch(/PIN code/i);
    expect(shippingAddressBookingBlock({ ...valid, address_validation_status: "INVALID" })).toBeTruthy();
    expect(shippingAddressBookingBlock(null)).toMatch(/Missing shipping address/i);
  });
});
