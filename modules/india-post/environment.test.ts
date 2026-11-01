import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertIndiaPostEnvironmentUrl,
  indiaPostHostname,
  indiaPostResolvedBaseUrl,
  isPostbusStagingRuntime,
} from "@/modules/india-post/environment";

const UAT = "https://test.cept.gov.in/beextcustomer";
const PROD = "https://app.indiapost.gov.in/beextcustomer";

describe("India Post environment isolation", () => {
  it("allows sandbox host for UAT and production host for PRODUCTION", () => {
    expect(assertIndiaPostEnvironmentUrl("UAT", UAT)).toBe("test.cept.gov.in");
    expect(assertIndiaPostEnvironmentUrl("PRODUCTION", PROD)).toBe("app.indiapost.gov.in");
    expect(indiaPostResolvedBaseUrl("UAT", UAT, PROD)).toBe(UAT);
    expect(indiaPostResolvedBaseUrl("PRODUCTION", UAT, PROD)).toBe(PROD);
  });

  it("fails closed when UAT is pointed at production CEPT", () => {
    expect(() => assertIndiaPostEnvironmentUrl("UAT", PROD)).toThrow(/cannot use a production CEPT/);
    expect(() => indiaPostResolvedBaseUrl("UAT", PROD, PROD)).toThrow(/cannot use a production CEPT/);
  });

  it("fails closed when PRODUCTION is pointed at sandbox CEPT", () => {
    expect(() => assertIndiaPostEnvironmentUrl("PRODUCTION", UAT)).toThrow(/cannot use the sandbox CEPT/);
    expect(() => indiaPostResolvedBaseUrl("PRODUCTION", UAT, UAT)).toThrow(/cannot use the sandbox CEPT/);
  });

  it("allows localhost stubs and rejects unknown hosts", () => {
    expect(indiaPostHostname("http://127.0.0.1:4099/beextcustomer")).toBe("127.0.0.1");
    expect(assertIndiaPostEnvironmentUrl("UAT", "http://127.0.0.1:4099/beextcustomer")).toBe("127.0.0.1");
    expect(() => assertIndiaPostEnvironmentUrl("UAT", "https://evil.example/beextcustomer")).toThrow(
      /not an allowed sandbox host/
    );
  });
});

describe("staging India Post fail-closed resolver", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats POSTBUS_ENV=staging as staging runtime", () => {
    vi.stubEnv("POSTBUS_ENV", "staging");
    expect(isPostbusStagingRuntime()).toBe(true);
  });

  it("rejects missing, empty, invalid protocol, and live CEPT hosts", () => {
    vi.stubEnv("POSTBUS_ENV", "staging");
    expect(() => assertIndiaPostEnvironmentUrl("UAT", "")).toThrow(/missing/);
    expect(() => assertIndiaPostEnvironmentUrl("UAT", "ftp://127.0.0.1:4099/beextcustomer")).toThrow(/http or https/);
    expect(() => assertIndiaPostEnvironmentUrl("UAT", "https://app.indiapost.gov.in/beextcustomer")).toThrow(/live CEPT/);
    expect(() => assertIndiaPostEnvironmentUrl("PRODUCTION", "https://test.cept.gov.in/beextcustomer")).toThrow(
      /live CEPT/
    );
  });

  it("rejects unexpected hosts and allows an explicit mock allowlist", () => {
    vi.stubEnv("POSTBUS_ENV", "staging");
    expect(() => assertIndiaPostEnvironmentUrl("UAT", "https://evil.example/beextcustomer")).toThrow(/allowlist/);
    vi.stubEnv("INDIA_POST_STAGING_ALLOWED_HOSTS", "cept-mock.staging.internal");
    expect(assertIndiaPostEnvironmentUrl("UAT", "https://cept-mock.staging.internal/beextcustomer")).toBe(
      "cept-mock.staging.internal"
    );
    expect(assertIndiaPostEnvironmentUrl("PRODUCTION", "https://cept-mock.staging.internal/beextcustomer")).toBe(
      "cept-mock.staging.internal"
    );
  });

  it("does not resolve a live fallback when the mock host is used", () => {
    vi.stubEnv("POSTBUS_ENV", "staging");
    vi.stubEnv("INDIA_POST_STAGING_ALLOWED_HOSTS", "127.0.0.1");
    expect(indiaPostResolvedBaseUrl("UAT", "http://127.0.0.1:4099/beextcustomer", "http://127.0.0.1:4099/beextcustomer")).toBe(
      "http://127.0.0.1:4099/beextcustomer"
    );
    expect(() =>
      indiaPostResolvedBaseUrl("UAT", "http://127.0.0.1:4099/beextcustomer", "https://app.indiapost.gov.in/beextcustomer")
    ).not.toThrow();
    expect(() => indiaPostResolvedBaseUrl("PRODUCTION", "http://127.0.0.1:4099/beextcustomer", "https://app.indiapost.gov.in/beextcustomer")).toThrow(
      /live CEPT/
    );
  });
});
