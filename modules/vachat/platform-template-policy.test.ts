import { describe, expect, it } from "vitest";
import { platformTemplateDecision } from "@/modules/vachat/platform-template-policy";

describe("platformTemplateDecision", () => {
  it("rejects missing name and missing catalog", () => {
    expect(platformTemplateDecision("", []).reason).toBe("missing_name");
    expect(platformTemplateDecision("welcome", null).reason).toBe("catalog_unavailable");
  });

  it("allows an approved UTILITY template", () => {
    expect(
      platformTemplateDecision("signup_hello", [
        { name: "signup_hello", status: "APPROVED", category: "UTILITY", language: "en" },
      ])
    ).toEqual({ allow: true, language: "en" });
  });

  it("allows an approved MARKETING template", () => {
    expect(
      platformTemplateDecision("signup_hello", [
        { name: "signup_hello", status: "APPROVED", category: "MARKETING", language: "en_US" },
      ]).allow
    ).toBe(true);
  });

  it("forbids AUTHENTICATION templates", () => {
    expect(
      platformTemplateDecision("postbus_otp", [
        { name: "postbus_otp", status: "APPROVED", category: "AUTHENTICATION" },
      ]).reason
    ).toBe("authentication_forbidden");
  });

  it("rejects unapproved or unknown names", () => {
    expect(
      platformTemplateDecision("signup_hello", [
        { name: "signup_hello", status: "PENDING", category: "UTILITY" },
      ]).reason
    ).toBe("not_approved");
    expect(platformTemplateDecision("missing", [{ name: "other", status: "APPROVED", category: "UTILITY" }]).reason).toBe(
      "not_found"
    );
  });
});
