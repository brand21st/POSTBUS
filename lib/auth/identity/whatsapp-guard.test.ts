import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { profileWhatsappChangeAllowed } from "@/lib/auth/identity/whatsapp-guard";

describe("profile WhatsApp number guard", () => {
  it("lets a merchant update other fields by leaving the number unchanged", () => {
    expect(
      profileWhatsappChangeAllowed({
        jwtRole: "authenticated",
        userId: "user-1",
        previousNumber: "+919876543210",
        nextNumber: "+919876543210",
      })
    ).toBe(true);
  });

  it("blocks a merchant from changing or assigning a WhatsApp number", () => {
    expect(
      profileWhatsappChangeAllowed({
        jwtRole: "authenticated",
        userId: "user-1",
        previousNumber: "+919876543210",
        nextNumber: "+919999999999",
      })
    ).toBe(false);
    expect(
      profileWhatsappChangeAllowed({
        jwtRole: "anon",
        userId: null,
        previousNumber: null,
        nextNumber: "+919876543210",
      })
    ).toBe(false);
  });

  it("lets the service role manage the number", () => {
    expect(
      profileWhatsappChangeAllowed({
        jwtRole: "service_role",
        userId: null,
        previousNumber: null,
        nextNumber: "+919876543210",
      })
    ).toBe(true);
  });

  it("keeps the database trigger aligned with that decision", () => {
    const sql = readFileSync("supabase/migrations/20261009021000_protect_profile_whatsapp_number.sql", "utf8");
    expect(sql).toContain("before update of whatsapp_number");
    expect(sql).toContain("jwt_role = 'service_role'");
    expect(sql).toContain("auth.uid() is null");
    expect(sql).toContain("errcode = '42501'");
    expect(sql).not.toMatch(/create unique index/i);
    expect(sql).not.toContain("delete from public.profiles");
  });
});
