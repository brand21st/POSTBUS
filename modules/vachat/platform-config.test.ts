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
    supportEnabled: false,
    eventSettings: {
      order_confirmation: false,
      processing: false,
      booked: false,
      in_transit: false,
      shipment_delayed: false,
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

describe("merchant VaChat overrides PostBus WhatsApp", () => {
  it("treats a connected org row as merchant-ready", async () => {
    const { merchantVachatRowReady } = await import("@/modules/vachat/platform-config");
    expect(merchantVachatRowReady({ status: "CONNECTED", encrypted_api_key: "enc" })).toBe(true);
    expect(merchantVachatRowReady({ status: "NOT_CONNECTED", encrypted_api_key: "enc" })).toBe(false);
    expect(merchantVachatRowReady({ status: "CONNECTED" })).toBe(false);
  });

  it("resolves merchant credentials instead of the platform number", async () => {
    const { encryptSecret } = await import("@/lib/security/crypto");
    const { resolveVachatSendCredentials } = await import("@/modules/vachat/platform-config");
    const creds = await resolveVachatSendCredentials("org-1", {
      encrypted_api_key: encryptSecret("merchant-key"),
      api_base_url: "https://cloud.vachat.in",
      status: "CONNECTED",
      id: "c1",
    });
    expect(creds).toEqual(
      expect.objectContaining({ source: "organization", apiKey: "merchant-key", connectionId: "c1" })
    );
  });

  it("does not fall back to PostBus WhatsApp when the merchant key cannot be decrypted", async () => {
    const { resolveVachatSendCredentials } = await import("@/modules/vachat/platform-config");
    await expect(
      resolveVachatSendCredentials("org-1", {
        encrypted_api_key: "not-valid",
        status: "CONNECTED",
      })
    ).resolves.toBeNull();
  });
});
