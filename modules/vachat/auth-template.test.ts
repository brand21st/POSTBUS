import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendVachatAuthenticationTemplate } from "@/modules/vachat/send";

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

describe("sendVachatAuthenticationTemplate", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("fails closed when platform VaChat or the template name is missing", async () => {
    vi.mocked(getPlatformVachatConfig).mockResolvedValue({
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
        shipment_delayed: false,
        delivered: false,
      },
      source: "none",
    });
    await expect(
      sendVachatAuthenticationTemplate({
        to: "+919876543210",
        templateName: "postbus_otp",
        language: "en",
        otp: "123456",
      })
    ).rejects.toThrow("vachat_auth_unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends an AUTHENTICATION template and does not use session text", async () => {
    vi.mocked(getPlatformVachatConfig).mockResolvedValue({
      flagEnabled: true,
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
      source: "env",
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            approved_templates: [{ name: "postbus_otp", status: "APPROVED", category: "AUTHENTICATION" }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { message_id: "m1" } }),
      });
    const result = await sendVachatAuthenticationTemplate({
      to: "9876543210",
      templateName: "postbus_otp",
      language: "en",
      otp: "654321",
    });
    expect(result.messageId).toBe("m1");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://cloud.vachat.in/api/v1/messages");
    const body = JSON.parse(String(init.body));
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("postbus_otp");
    expect(body.template.params.body).toEqual(["654321"]);
    expect(body.text).toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://cloud.vachat.in/api/postbus/templates");
  });

  it("does not send when the catalog template is not AUTHENTICATION", async () => {
    vi.mocked(getPlatformVachatConfig).mockResolvedValue({
      flagEnabled: true,
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
      source: "env",
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { approved_templates: [{ name: "postbus_otp", status: "APPROVED", category: "UTILITY" }] },
      }),
    });
    await expect(
      sendVachatAuthenticationTemplate({
        to: "+919876543210",
        templateName: "postbus_otp",
        language: "en",
        otp: "123456",
      })
    ).rejects.toThrow("vachat_auth_not_authentication");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
