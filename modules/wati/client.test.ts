import { describe, expect, it } from "vitest";
import {
  extractWatiClientId,
  normalizeWatiBaseUrl,
  normalizeWatiClientId,
  pickWhatsappChannel,
  watiErrorMessage,
  watiPhoneNumber,
} from "@/modules/wati/client";

describe("normalizeWatiBaseUrl", () => {
  it("defaults and strips tenant or api paths from pasted V1 hosts", () => {
    expect(normalizeWatiBaseUrl("")).toBe("https://live-mt-server.wati.io");
    expect(normalizeWatiBaseUrl("https://live-mt-server.wati.io/382123/")).toBe(
      "https://live-mt-server.wati.io"
    );
    expect(normalizeWatiBaseUrl("https://live-mt-server.wati.io/382123/api/v1")).toBe(
      "https://live-mt-server.wati.io"
    );
    expect(normalizeWatiBaseUrl("live-mt-server.wati.io")).toBe("https://live-mt-server.wati.io");
  });
});

describe("extractWatiClientId", () => {
  it("reads a workspace id from a pasted V1 endpoint or a plain id", () => {
    expect(extractWatiClientId("https://live-mt-server.wati.io/382123/")).toBe("382123");
    expect(extractWatiClientId("https://live-mt-server.wati.io/382123/api/v1")).toBe("382123");
    expect(normalizeWatiClientId("382123")).toBe("382123");
    expect(extractWatiClientId("https://live-mt-server.wati.io")).toBe("");
    expect(extractWatiClientId("")).toBe("");
  });
});

describe("watiPhoneNumber", () => {
  it("formats Indian mobiles as 91 plus 10 digits", () => {
    expect(watiPhoneNumber("9876543210")).toBe("919876543210");
    expect(watiPhoneNumber("+91 98765 43210")).toBe("919876543210");
    expect(watiPhoneNumber("bad")).toBeNull();
  });
});

describe("pickWhatsappChannel", () => {
  it("prefers an enabled WhatsApp channel", () => {
    const channel = pickWhatsappChannel([
      { id: "ig", channel: "Instagram", enabled: true },
      { id: "wa", name: "Support", channel: "WhatsApp", platform_id: "919800000000", enabled: true },
    ]);
    expect(channel?.id).toBe("wa");
    expect(channel?.platform_id).toBe("919800000000");
  });
});

describe("watiErrorMessage", () => {
  it("reads V3 error objects", () => {
    expect(
      watiErrorMessage(400, { ok: false, error: { code: "bad", message: "Missing token scopes." } }, "fail")
    ).toBe("Missing token scopes.");
    expect(watiErrorMessage(401, {}, "fail")).toBe("Wati rejected the API token.");
  });
});
