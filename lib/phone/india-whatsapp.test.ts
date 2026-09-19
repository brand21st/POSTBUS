import { describe, expect, it } from "vitest";
import {
  extractIndiaMobileDigits,
  indiaMobileInputDigits,
  isIndiaWhatsappInput,
  toIndiaWhatsappE164,
} from "./india-whatsapp";

describe("extractIndiaMobileDigits", () => {
  it("accepts 10-digit numbers starting 6-9", () => {
    expect(extractIndiaMobileDigits("9876543210")).toBe("9876543210");
    expect(extractIndiaMobileDigits("6123456789")).toBe("6123456789");
  });

  it("accepts +91 and 91 prefixes", () => {
    expect(extractIndiaMobileDigits("+91 98765 43210")).toBe("9876543210");
    expect(extractIndiaMobileDigits("919876543210")).toBe("9876543210");
    expect(extractIndiaMobileDigits("09876543210")).toBe("9876543210");
  });

  it("rejects non-Indian lengths and invalid first digits", () => {
    expect(extractIndiaMobileDigits("5876543210")).toBeNull();
    expect(extractIndiaMobileDigits("987654321")).toBeNull();
    expect(extractIndiaMobileDigits("98765432101")).toBeNull();
    expect(extractIndiaMobileDigits("abcdefghij")).toBeNull();
  });
});

describe("toIndiaWhatsappE164", () => {
  it("normalizes to +91 and 10 digits", () => {
    expect(toIndiaWhatsappE164("9876543210")).toBe("+919876543210");
    expect(toIndiaWhatsappE164("+91-98765-43210")).toBe("+919876543210");
  });

  it("throws for invalid input", () => {
    expect(() => toIndiaWhatsappE164("12345")).toThrow(/10-digit Indian WhatsApp/);
  });
});

describe("isIndiaWhatsappInput", () => {
  it("matches valid Indian mobiles only", () => {
    expect(isIndiaWhatsappInput("9876543210")).toBe(true);
    expect(isIndiaWhatsappInput("5876543210")).toBe(false);
  });
});

describe("indiaMobileInputDigits", () => {
  it("keeps 10 digits while typing and strips +91 on paste", () => {
    expect(indiaMobileInputDigits("98765")).toBe("98765");
    expect(indiaMobileInputDigits("+91 98765 43210")).toBe("9876543210");
    expect(indiaMobileInputDigits("919876543210")).toBe("9876543210");
    expect(indiaMobileInputDigits("9876543210123")).toBe("9876543210");
  });
});
