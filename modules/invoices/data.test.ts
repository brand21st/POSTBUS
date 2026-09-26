import { describe, expect, it } from "vitest";
import {
  formatShipmentNumber,
  organizationInvoiceParty,
} from "@/modules/invoices/data";

describe("invoice data helpers", () => {
  it("formats organization-scoped shipment numbers for display", () => {
    expect(formatShipmentNumber(13)).toBe("SHP-000013");
    expect(formatShipmentNumber("42")).toBe("SHP-000042");
    expect(formatShipmentNumber(null)).toBe("");
    expect(formatShipmentNumber(0)).toBe("");
  });

  it("uses the organization identity for Bill To", () => {
    expect(
      organizationInvoiceParty(
        {
          name: "Aurimo by Nish",
          phone: "9605658104",
          line1: "Kolenchery",
          line2: "Near Post Office",
          city: "Ernakulam",
          state: "Kerala",
          pincode: "682311",
        },
        "billing@aurimo.in"
      )
    ).toEqual({
      name: "Aurimo by Nish",
      phone: "9605658104",
      email: "billing@aurimo.in",
      lines: ["Kolenchery, Near Post Office", "Ernakulam, Kerala, 682311"],
    });
  });
});
