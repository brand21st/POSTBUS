import { describe, expect, it } from "vitest";
import {
  PRODUCTION_COOLIFY_APPLICATION_UUID,
  PRODUCTION_SUPABASE_REF,
  assertHostedStagingProvisioningTarget,
  assertNonProductionMutationTarget,
  assertStagingAuthIsolation,
  assertStagingRuntimeEnv,
  isStagingAuthMode,
  supabaseProjectRefFromUrl,
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

  it("refuses unknown or production mutation targets", () => {
    expect(() => assertNonProductionMutationTarget({})).toThrow(/unknown/);
    expect(() =>
      assertNonProductionMutationTarget({
        supabaseUrl: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
        operation: "affiliate migrate",
      })
    ).toThrow(/production/);
    expect(() =>
      assertNonProductionMutationTarget({
        databaseUrl: "postgresql://postbus_staging@127.0.0.1:55432/postbus_staging",
        operation: "affiliate migrate",
      })
    ).not.toThrow();
  });

  it("staging runtime fails closed without a non-production URL and live keys", () => {
    expect(supabaseProjectRefFromUrl(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`)).toBe(PRODUCTION_SUPABASE_REF);
    expect(() => assertStagingRuntimeEnv({})).toThrow(/fall back to production/);
    expect(() =>
      assertStagingRuntimeEnv({ NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co` })
    ).toThrow(/production/);
    expect(() =>
      assertStagingRuntimeEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
        RAZORPAY_KEY_ID: "rzp_live_example",
      })
    ).toThrow(/live Razorpay/);
    expect(() =>
      assertStagingRuntimeEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
        POSTBUS_AFFILIATE_PAYOUTS_ENABLED: "true",
      })
    ).toThrow(/payouts/);
    expect(
      assertStagingRuntimeEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
        POSTBUS_STAGING_PROJECT_REF: "abcdefghijklmnop",
      }).projectRef
    ).toBe("abcdefghijklmnop");
    expect(() =>
      assertStagingRuntimeEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
      })
    ).toThrow(/POSTBUS_STAGING_PROJECT_REF/);
    expect(() =>
      assertStagingRuntimeEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
        POSTBUS_STAGING_PROJECT_REF: "abcdefghijklmnop",
        INDIA_POST_UAT_BASE_URL: "https://app.indiapost.gov.in/beextcustomer",
      })
    ).toThrow(/live India Post/);
    expect(() =>
      assertStagingRuntimeEnv({
        POSTBUS_ENV: "staging",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      })
    ).toThrow(/INDIA_POST_UAT_BASE_URL/);
    expect(() =>
      assertStagingRuntimeEnv({
        POSTBUS_ENV: "staging",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        INDIA_POST_UAT_BASE_URL: "http://127.0.0.1:4099/beextcustomer",
        INDIA_POST_PROD_BASE_URL: "http://127.0.0.1:4099/beextcustomer",
      })
    ).not.toThrow();
    expect(() =>
      assertHostedStagingProvisioningTarget({
        NEXT_PUBLIC_APP_URL: "https://www.postbus.in",
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
        POSTBUS_STAGING_PROJECT_REF: "abcdefghijklmnop",
      })
    ).toThrow(/production website/);
    expect(() =>
      assertHostedStagingProvisioningTarget({
        NEXT_PUBLIC_APP_URL: "https://staging.postbus.in",
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
        POSTBUS_STAGING_PROJECT_REF: "abcdefghijklmnop",
        COOLIFY_APPLICATION_UUID: PRODUCTION_COOLIFY_APPLICATION_UUID,
      })
    ).toThrow(/production Coolify/);
  });
});
