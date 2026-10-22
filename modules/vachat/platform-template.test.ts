import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendVachatPlatformTemplate } from "@/modules/vachat/send";

vi.mock("@/modules/vachat/platform-config", async () => {
  const actual = await vi.importActual<typeof import("@/modules/vachat/platform-config")>(
    "@/modules/vachat/platform-config"
  );
  return {
    ...actual,
    getPlatformVachatConfig: vi.fn(),
  };
});

import { getPlatformVachatConfig } from "@/modules/vachat/platform-config";

const fetchMock = vi.fn();

function activeConfig() {
  return {
    flagEnabled: true,
    supportEnabled: false,
    enabled: true,
    apiBaseUrl: "https://cloud.vachat.in",
    apiKey: "platform-key",
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
      shipment_delayed: false,
      delivered: false,
    },
    signupWelcomeEnabled: true,
    signupWelcomeTemplateName: "signup_hello",
    signupWelcomeTemplateLanguage: "en",
    source: "env" as const,
  };
}

describe("sendVachatPlatformTemplate", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("fails closed when platform VaChat is inactive", async () => {
    vi.mocked(getPlatformVachatConfig).mockResolvedValue({
      ...activeConfig(),
      enabled: false,
      apiKey: "",
    });
    await expect(
      sendVachatPlatformTemplate({
        to: "+919876543210",
        templateName: "signup_hello",
        bodyParams: ["Priya"],
      })
    ).rejects.toThrow("vachat_platform_unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends an approved UTILITY template with body params", async () => {
    vi.mocked(getPlatformVachatConfig).mockResolvedValue(activeConfig());
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            approved_templates: [{ name: "signup_hello", status: "APPROVED", category: "UTILITY", language: "en" }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { message_id: "m2" } }),
      });
    const result = await sendVachatPlatformTemplate({
      to: "9876543210",
      templateName: "signup_hello",
      language: "en",
      bodyParams: ["Priya"],
    });
    expect(result.messageId).toBe("m2");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://cloud.vachat.in/api/v1/messages");
    const body = JSON.parse(String(init.body));
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("signup_hello");
    expect(body.template.params.body).toEqual(["Priya"]);
  });

  it("does not send AUTHENTICATION templates", async () => {
    vi.mocked(getPlatformVachatConfig).mockResolvedValue(activeConfig());
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { approved_templates: [{ name: "signup_hello", status: "APPROVED", category: "AUTHENTICATION" }] },
      }),
    });
    await expect(
      sendVachatPlatformTemplate({
        to: "+919876543210",
        templateName: "signup_hello",
        bodyParams: ["Priya"],
      })
    ).rejects.toThrow("vachat_platform_authentication_forbidden");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
