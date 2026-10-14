import { describe, expect, it } from "vitest";
import {
  PRODUCTION_SUPABASE_REF,
  assertStagingAuthIsolation,
  isStagingAuthMode,
} from "@/lib/env/staging-isolation";

describe("staging Auth isolation", () => {
  it("does not treat production or local next as staging", () => {
    expect(isStagingAuthMode({ mode: "", appUrl: "https://www.postbus.in" })).toBe(false);
    expect(isStagingAuthMode({ appUrl: "http://localhost:3000" })).toBe(false);
  });

  it("rejects the production Supabase project when staging mode is set", () => {
    expect(() =>
      assertStagingAuthIsolation({
        mode: "staging",
        supabaseUrl: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
        appUrl: "https://auth-staging.postbus.in",
      })
    ).toThrow(/production Supabase project/);
  });

  it("allows a non-production Auth URL in staging mode", () => {
    expect(() =>
      assertStagingAuthIsolation({
        mode: "staging",
        supabaseUrl: "https://abcdefghijklmnop.supabase.co",
        appUrl: "https://auth-staging.postbus.in",
      })
    ).not.toThrow();
  });
});
