import { describe, expect, it } from "vitest";
import { isPlatformVachatActive, type PlatformVachatConfig } from "@/modules/vachat/platform-config";

function config(overrides: Partial<PlatformVachatConfig> = {}): PlatformVachatConfig {
  return {
    flagEnabled: false,
    enabled: false,
    apiBaseUrl: "https://cloud.vachat.in",
    apiKey: "",
    webhookSecret: "",
    webhookEndpointId: null,
    lastVerifiedAt: null,
    lastError: null,
    lastTestPhone: null,
    eventSettings: {
      order_confirmation: false,
      processing: false,
      booked: false,
      in_transit: false,
      delivered: false,
    },
    source: "none",
    ...overrides,
  };
}

describe("isPlatformVachatActive", () => {
  it("requires the enabled flag and an API key", () => {
    expect(isPlatformVachatActive(config({ enabled: true, apiKey: "wacrm_live_x" }))).toBe(true);
    expect(isPlatformVachatActive(config({ enabled: true, apiKey: "" }))).toBe(false);
    expect(isPlatformVachatActive(config({ enabled: false, apiKey: "wacrm_live_x" }))).toBe(false);
  });
});

describe("parseVachatEventSettings", () => {
  it("defaults all live events to false", async () => {
    const { parseVachatEventSettings, isPlatformVachatEventEnabled } = await import(
      "@/modules/vachat/platform-config"
    );
    expect(parseVachatEventSettings(null).booked).toBe(false);
    expect(parseVachatEventSettings({ booked: true }).booked).toBe(true);
    expect(
      isPlatformVachatEventEnabled(config({ enabled: true, apiKey: "k", eventSettings: parseVachatEventSettings({ booked: true }) }), "booked")
    ).toBe(true);
    expect(
      isPlatformVachatEventEnabled(config({ enabled: false, apiKey: "k", eventSettings: parseVachatEventSettings({ booked: true }) }), "booked")
    ).toBe(false);
  });
});
