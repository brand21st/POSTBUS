import { describe, expect, it } from "vitest";
import { PRODUCTION_SUPABASE_REF } from "@/lib/env/staging-isolation";
import {
  SHOPIFY_DEV_PROJECT_REF,
  assertShopifyDevRuntimeEnv,
  parseJobRunner,
} from "@/lib/env/shopify-dev-isolation";

const valid = {
  POSTBUS_SHOPIFY_DEV: "true",
  POSTBUS_SHOPIFY_DEV_PROJECT_REF: SHOPIFY_DEV_PROJECT_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${SHOPIFY_DEV_PROJECT_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  INTEGRATION_ENCRYPTION_KEY: "shopify-dev-encryption-key-32ch!",
  JOB_RUNNER: "none",
  SHOPIFY_EMBEDDED_APP_ENABLED: "true",
};

describe("shopify cloud-dev isolation", () => {
  it("parses job runner none aliases", () => {
    expect(parseJobRunner("none")).toBe("none");
    expect(parseJobRunner("off")).toBe("none");
    expect(parseJobRunner("disabled")).toBe("none");
    expect(parseJobRunner("database")).toBe("database");
    expect(parseJobRunner("")).toBe("database");
  });

  it("rejects missing overlay flag and production project", () => {
    expect(() => assertShopifyDevRuntimeEnv({})).toThrow(/POSTBUS_SHOPIFY_DEV=true/);
    expect(() =>
      assertShopifyDevRuntimeEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
        POSTBUS_SHOPIFY_DEV_PROJECT_REF: PRODUCTION_SUPABASE_REF,
      })
    ).toThrow(/production/);
  });

  it("rejects loopback, job drain, BYO Shopify, and live Razorpay", () => {
    expect(() =>
      assertShopifyDevRuntimeEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })
    ).toThrow(/hosted/);
    expect(() => assertShopifyDevRuntimeEnv({ ...valid, JOB_RUNNER: "database" })).toThrow(/JOB_RUNNER=none/);
    expect(() =>
      assertShopifyDevRuntimeEnv({ ...valid, SHOPIFY_API_KEY: "shpka_x" })
    ).toThrow(/BYO/);
    expect(() =>
      assertShopifyDevRuntimeEnv({ ...valid, RAZORPAY_KEY_ID: "rzp_live_x" })
    ).toThrow(/Razorpay/);
    expect(() =>
      assertShopifyDevRuntimeEnv({ ...valid, SHOPIFY_EMBEDDED_APP_ENABLED: "false" })
    ).toThrow(/SHOPIFY_EMBEDDED_APP_ENABLED/);
    expect(() =>
      assertShopifyDevRuntimeEnv({ ...valid, INTEGRATION_ENCRYPTION_KEY: "" })
    ).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
  });

  it("rejects URL and allowlist mismatch", () => {
    expect(() =>
      assertShopifyDevRuntimeEnv({
        ...valid,
        POSTBUS_SHOPIFY_DEV_PROJECT_REF: "otherprojectrefxx",
      })
    ).toThrow(/postbus-shopify-dev/);
    expect(() =>
      assertShopifyDevRuntimeEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
      })
    ).toThrow(/does not match/);
  });

  it("allows hosted postbus-shopify-dev with jobs off", () => {
    expect(assertShopifyDevRuntimeEnv(valid)).toEqual({
      supabaseUrl: valid.NEXT_PUBLIC_SUPABASE_URL,
      projectRef: SHOPIFY_DEV_PROJECT_REF,
      projectName: "postbus-shopify-dev",
    });
  });
});
