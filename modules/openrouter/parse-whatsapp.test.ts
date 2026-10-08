import { describe, expect, it } from "vitest";
import { mergeWhatsAppPasteResult, whatsappPasteSchema } from "@/modules/openrouter/parse-whatsapp";

const LABELED = `Name: Rahul
Phone: 9876543210
Address: 12 ABC House
City: Kozhikode
State: Kerala
PIN: 673001`;

describe("mergeWhatsAppPasteResult", () => {
  it("uses the rules parser when AI JSON is missing", () => {
    const result = mergeWhatsAppPasteResult(LABELED, null);
    expect(result.source).toBe("rules");
    expect(result.fields.phone).toBe("9876543210");
    expect(result.fields.pincode).toBe("673001");
  });

  it("prefers validated AI fields when any value survives", () => {
    const result = mergeWhatsAppPasteResult("random prose without labels", {
      name: "Meera",
      phone: "9876543210",
      line1: "8 Lake View",
      city: "Thrissur",
      state: "Kerala",
      pincode: "680001",
    });
    expect(result.source).toBe("ai");
    expect(result.fields).toMatchObject({
      name: "Meera",
      phone: "9876543210",
      city: "Thrissur",
      pincode: "680001",
    });
  });

  it("falls back to rules when AI JSON has no valid fields", () => {
    const result = mergeWhatsAppPasteResult(LABELED, { phone: "123", pincode: "xx" });
    expect(result.source).toBe("rules");
    expect(result.fields.phone).toBe("9876543210");
  });
});

describe("whatsappPasteSchema", () => {
  it("rejects empty paste", () => {
    expect(() => whatsappPasteSchema.parse({ text: "  " })).toThrow();
  });
});
