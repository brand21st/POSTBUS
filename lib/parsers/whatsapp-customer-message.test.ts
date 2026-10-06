import { describe, expect, it } from "vitest";
import {
  applyWhatsAppCustomerFields,
  parseWhatsAppCustomerMessage,
} from "@/lib/parsers/whatsapp-customer-message";

const SAMPLE = `Name: Rahul
Phone: 9876543210
Address: 12 ABC House, Main Road
City: Kozhikode
State: Kerala
PIN: 673001`;

describe("parseWhatsAppCustomerMessage", () => {
  it("maps common labeled lines", () => {
    const parsed = parseWhatsAppCustomerMessage(SAMPLE);
    expect(parsed.fields).toEqual({
      name: "Rahul",
      phone: "9876543210",
      line1: "12 ABC House, Main Road",
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673001",
    });
  });

  it("accepts Mobile, District, Pin Code, and +91 phones", () => {
    const parsed = parseWhatsAppCustomerMessage(`
      Customer Name: Anitha
      Mobile: +91 88487 72371
      Address: Flat 2
      Beach Road
      District: Ernakulam
      State: kerala
      Pin Code: 682001
    `);
    expect(parsed.fields.name).toBe("Anitha");
    expect(parsed.fields.phone).toBe("8848772371");
    expect(parsed.fields.line1).toContain("Flat 2");
    expect(parsed.fields.line1).toContain("Beach Road");
    expect(parsed.fields.city).toBe("Ernakulam");
    expect(parsed.fields.state).toBe("Kerala");
    expect(parsed.fields.pincode).toBe("682001");
  });

  it("ignores malformed phone and pin values", () => {
    const parsed = parseWhatsAppCustomerMessage(`Name: X\nPhone: 12345\nPIN: 12AB`);
    expect(parsed.fields.phone).toBeUndefined();
    expect(parsed.fields.pincode).toBeUndefined();
    expect(parsed.fields.name).toBeUndefined();
  });

  it("maps Full Name, Town, and Postal Code", () => {
    const parsed = parseWhatsAppCustomerMessage(`
      Full Name: Meera
      Phone Number: 9876543210
      Full Address: 8 Lake View
      Town: Thrissur
      Postal Code: 680001
    `);
    expect(parsed.fields.name).toBe("Meera");
    expect(parsed.fields.line1).toBe("8 Lake View");
    expect(parsed.fields.city).toBe("Thrissur");
    expect(parsed.fields.pincode).toBe("680001");
  });

  it("does not overwrite filled fields", () => {
    const parsed = parseWhatsAppCustomerMessage(SAMPLE);
    const applied = applyWhatsAppCustomerFields(
      { name: "Existing", phone: "", city: "" },
      parsed.fields
    );
    expect(applied.name).toBe("Existing");
    expect(applied.phone).toBe("9876543210");
    expect(applied.city).toBe("Kozhikode");
  });

  it("returns empty fields for unstructured text", () => {
    const parsed = parseWhatsAppCustomerMessage("please send to my house tomorrow thanks");
    expect(parsed.fields).toEqual({});
  });
});
