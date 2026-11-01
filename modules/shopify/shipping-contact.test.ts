import { describe, expect, it } from "vitest";
import {
  addressStatusLabel,
  applyAiAddressSuggestion,
  normalizeShopifyShipping,
  pinOfficeStateConflict,
  shopifyRecipientPhone,
} from "@/modules/shopify/shipping-contact";

const ready = {
  first_name: "Rahul",
  last_name: "K",
  phone: "9876543210",
  address1: "10B, Rose Villa",
  address2: "Near Bus Stand",
  city: "Kozhikode",
  province: "Kerala",
  zip: "673001",
  country_code: "IN",
};

describe("shopify shipping contact", () => {
  it("imports a complete address without asking for AI", () => {
    const contact = normalizeShopifyShipping({ shipping_address: ready });
    expect(contact.name).toBe("Rahul K");
    expect(contact.phone).toBe("9876543210");
    expect(contact.line1).toBe("10B, Rose Villa");
    expect(contact.city).toBe("Kozhikode");
    expect(contact.state).toBe("Kerala");
    expect(contact.pincode).toBe("673001");
    expect(contact.status).toBe("READY");
    expect(contact.needsAi).toBe(false);
    expect(contact.readyForBooking).toBe(true);
  });

  it("uses another order phone when the shipping phone is missing and flags the uncertainty", () => {
    const contact = normalizeShopifyShipping({
      shipping_address: { ...ready, phone: "" },
      phone: "",
      customer: { phone: "9123456780" },
    });
    expect(contact.phone).toBe("9123456780");
    expect(contact.phoneSource).toBe("customer");
    expect(contact.originalPhone).toBe("9123456780");
    expect(contact.status).toBe("NEEDS_REVIEW");
    expect(contact.readyForBooking).toBe(false);
  });

  it("normalizes common Indian mobile formats to 10 digits", () => {
    for (const value of ["+91 98765 43210", "91-9876543210", "09876543210", "98765 43210", "9876543210"]) {
      expect(shopifyRecipientPhone({ shipping_address: { phone: value } }).phone).toBe("9876543210");
    }
  });

  it("does not fabricate or truncate an invalid phone", () => {
    const short = normalizeShopifyShipping({ shipping_address: { ...ready, phone: "98765" } });
    const long = normalizeShopifyShipping({ shipping_address: { ...ready, phone: "987654321099" } });
    expect(short.phone).toBe("");
    expect(short.originalPhone).toBe("98765");
    expect(long.phone).toBe("");
    expect(long.status).toBe("INVALID");
    expect(short.issues.some((issue) => issue.code === "invalid_phone")).toBe(true);
  });

  it("removes a repeated building name and repeated state", () => {
    const contact = normalizeShopifyShipping({
      shipping_address: {
        ...ready,
        name: "Rahul K",
        address1: "10B, Rose Villa,, Rose Villa, Near Bus Stand,,, Kozhikode,",
        address2: "Kozhikode, Kerala, Kerala",
      },
    });
    expect(contact.line1).toBe("10B, Rose Villa");
    expect(contact.line2).toBe("Near Bus Stand");
    expect(contact.line3).toBe("");
    expect(contact.city).toBe("Kozhikode");
    expect(contact.state).toBe("Kerala");
    expect(contact.pincode).toBe("673001");
    expect(contact.status).toBe("READY");
    expect(contact.needsAi).toBe(false);
    expect(contact.changes).toContain("Removed duplicate address fragments");
  });

  it("cleans excessive commas without dropping the house or landmark", () => {
    const contact = normalizeShopifyShipping({
      shipping_address: {
        ...ready,
        address1: "12A,,,  Lake Road,,,",
        address2: ",, Near Temple,,",
      },
    });
    expect(contact.line1).toContain("12A");
    expect(contact.line1).toContain("Lake Road");
    expect(`${contact.line1} ${contact.line2}`).toContain("Near Temple");
    expect(contact.line1.includes(",,")).toBe(false);
  });

  it("keeps a long address and asks for review instead of truncating it", () => {
    const tail = Array.from({ length: 50 }, (_, index) => `Ward${index}`).join(", ");
    const contact = normalizeShopifyShipping({
      shipping_address: { ...ready, address1: `10B, ${tail}`, address2: "" },
    });
    expect(`${contact.line1} ${contact.line2} ${contact.line3}`).toContain("Ward29");
    expect(contact.status).toBe("NEEDS_REVIEW");
    expect(contact.readyForBooking).toBe(false);
    expect(contact.issues.some((issue) => issue.code === "address_too_long")).toBe(true);
  });

  it("moves an unambiguous city out of the street and leaves an ambiguous city for review", () => {
    const clear = normalizeShopifyShipping({
      shipping_address: { ...ready, address1: "House 12, Kozhikode", address2: "", city: "" },
    });
    expect(clear.city).toBe("Kozhikode");
    expect(clear.line1).toContain("House 12");
    const ambiguous = normalizeShopifyShipping({
      shipping_address: { ...ready, address1: "Rose Villa, Market Road", address2: "", city: "" },
    });
    expect(ambiguous.city).toBe("");
    expect(ambiguous.status).toBe("INVALID");
  });

  it("never invents a PIN code", () => {
    const contact = normalizeShopifyShipping({
      shipping_address: { ...ready, zip: "", address2: "Near Bus Stand" },
    });
    expect(contact.pincode).toBe("");
    expect(contact.status).toBe("INVALID");
    expect(JSON.stringify(contact)).not.toContain("000000");
  });

  it("does not use an email-shaped shipping name or invent a recipient", () => {
    const contact = normalizeShopifyShipping({
      shipping_address: { ...ready, name: "buyer@example.com", first_name: "", last_name: "" },
      customer: { first_name: "buyer@example.com", last_name: "" },
    });
    expect(contact.name).toBe("");
    expect(contact.status).toBe("INVALID");
  });

  it("rejects an AI suggestion that invents a street and accepts a reorder of the original text", () => {
    const contact = normalizeShopifyShipping({
      shipping_address: {
        ...ready,
        address1: "10B, Rose Villa, Rose Villa, Near Bus Stand, Kozhikode, Kerala",
      },
    });
    const invented = applyAiAddressSuggestion(contact, {
      address_line_1: "10B, Palm Avenue",
      address_line_2: "Near Bus Stand",
      address_line_3: "",
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673001",
      changes: ["Rewrote the street"],
      warnings: [],
      needs_review: false,
    });
    expect(invented).toBeNull();
    const accepted = applyAiAddressSuggestion(contact, {
      address_line_1: "10B, Rose Villa",
      address_line_2: "Near Bus Stand",
      address_line_3: "",
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673001",
      changes: ["Separated the landmark"],
      warnings: [],
      needs_review: false,
    });
    expect(accepted?.line1).toBe("10B, Rose Villa");
    expect(accepted?.source).toBe("ai");
    expect(accepted?.pincode).toBe("673001");
  });

  it("reports a PIN office state conflict without changing the address", () => {
    expect(pinOfficeStateConflict("Kerala", "Tamil Nadu")).toBe(true);
    expect(pinOfficeStateConflict("Kerala", "KL")).toBe(false);
    expect(addressStatusLabel("INVALID")).toBe("Invalid Shipping Details");
    expect(addressStatusLabel("NEEDS_REVIEW")).toBe("Address Review Required");
    expect(addressStatusLabel("READY")).toBe("Ready for Booking");
  });
});
