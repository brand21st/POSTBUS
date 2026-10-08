import { describe, expect, it } from "vitest";
import {
  assertIndiaPostEnvironmentUrl,
  indiaPostHostname,
  indiaPostResolvedBaseUrl,
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
