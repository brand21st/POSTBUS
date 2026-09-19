import { describe, expect, it } from "vitest";
import { registerAccountSchema } from "./register-schema";

describe("registerAccountSchema", () => {
  const base = {
    name: "Priya Stores",
    email: "priya@example.com",
    password: "shipfast1",
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
});
