import { describe, expect, it } from "vitest";
import { registerAccountSchema } from "./register-schema";

describe("registerAccountSchema", () => {
  const base = {
    name: "Priya Stores",
    email: "priya@example.com",
    password: "shipfast1",
    pincode: "560001",
    city: "Bengaluru",
  };

  it("stores WhatsApp as +91 E.164 from 10 digits", () => {
    const parsed = registerAccountSchema.parse({ ...base, whatsapp: "9876543210" });
    expect(parsed.whatsapp).toBe("+919876543210");
  });

  it("accepts formatted Indian numbers", () => {
    const parsed = registerAccountSchema.parse({ ...base, whatsapp: "+91 98765 43210" });
    expect(parsed.whatsapp).toBe("+919876543210");
  });

  it("rejects short, long, and non-mobile numbers", () => {
    expect(() => registerAccountSchema.parse({ ...base, whatsapp: "987654321" })).toThrow();
    expect(() => registerAccountSchema.parse({ ...base, whatsapp: "98765432101" })).toThrow();
    expect(() => registerAccountSchema.parse({ ...base, whatsapp: "5876543210" })).toThrow();
  });

  it("accepts a 6-digit PIN code and trims city", () => {
    const parsed = registerAccountSchema.parse({
      ...base,
      whatsapp: "9876543210",
      pincode: " 110001 ",
      city: " New Delhi ",
    });
    expect(parsed.pincode).toBe("110001");
    expect(parsed.city).toBe("New Delhi");
  });

  it("rejects invalid PIN codes", () => {
    expect(() => registerAccountSchema.parse({ ...base, whatsapp: "9876543210", pincode: "056001" })).toThrow();
    expect(() => registerAccountSchema.parse({ ...base, whatsapp: "9876543210", pincode: "56001" })).toThrow();
    expect(() => registerAccountSchema.parse({ ...base, whatsapp: "9876543210", pincode: "5600011" })).toThrow();
  });

  it("rejects a missing or too-short city", () => {
    expect(() => registerAccountSchema.parse({ ...base, whatsapp: "9876543210", city: "A" })).toThrow();
    expect(() => registerAccountSchema.parse({ ...base, whatsapp: "9876543210", city: "  " })).toThrow();
  });
});
