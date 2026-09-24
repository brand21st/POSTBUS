import { describe, expect, it } from "vitest";
import { matchesPlatformAdminEmail, signedInHomePath } from "@/lib/admin/access";

describe("platform admin routing", () => {
  it("matches the configured Super Admin email case-insensitively", () => {
    expect(matchesPlatformAdminEmail("super@super.com", "SUPER@super.com")).toBe(true);
    expect(matchesPlatformAdminEmail("merchant@shop.com", "super@super.com")).toBe(false);
    expect(matchesPlatformAdminEmail("super@super.com", "")).toBe(false);
  });

  it("sends Super Admin to /admin instead of the merchant dashboard", () => {
    expect(signedInHomePath(true)).toBe("/admin");
    expect(signedInHomePath(false)).toBe("/dashboard");
  });
});
