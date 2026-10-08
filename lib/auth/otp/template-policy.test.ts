import { describe, expect, it } from "vitest";
import { otpTemplateDecision } from "@/lib/auth/otp/template-policy";

const name = "postbus_otp";

describe("otpTemplateDecision", () => {
  it("rejects a missing name, a missing catalog, and an unknown template", () => {
    expect(otpTemplateDecision("", [{ name, status: "APPROVED", category: "AUTHENTICATION" }]).allow).toBe(false);
    expect(otpTemplateDecision(name, null)).toEqual({ allow: false, reason: "catalog_unavailable" });
    expect(otpTemplateDecision(name, [])).toEqual({ allow: false, reason: "not_found" });
  });

  it("rejects utility, marketing, unverified, and unapproved templates", () => {
    expect(otpTemplateDecision(name, [{ name, status: "APPROVED", category: "UTILITY" }])).toEqual({
      allow: false,
      reason: "not_authentication",
    });
    expect(otpTemplateDecision(name, [{ name, status: "APPROVED", category: "MARKETING" }])).toEqual({
      allow: false,
      reason: "not_authentication",
    });
    expect(otpTemplateDecision(name, [{ name, status: "APPROVED", category: null }])).toEqual({
      allow: false,
      reason: "category_unverified",
    });
    expect(otpTemplateDecision(name, [{ name, status: "PENDING", category: "AUTHENTICATION" }])).toEqual({
      allow: false,
      reason: "not_approved",
    });
  });

  it("allows only an approved AUTHENTICATION template", () => {
    expect(otpTemplateDecision(name, [{ name, status: "APPROVED", category: "Authentication" }])).toEqual({
      allow: true,
    });
  });
});
