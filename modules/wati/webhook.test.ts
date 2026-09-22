import { describe, expect, it } from "vitest";
import { assertWebhookCreated, findWatiWebhook } from "@/modules/wati/register-webhook";
import {
  parseWatiWebhookEvent,
  parseWatiWebhookEvents,
  shouldNotifyWatiEvent,
  watiWebhookNotification,
} from "@/modules/wati/webhook";
import { canRegisterWatiWebhook, parseWatiWebhookPath, watiWebhookUrl } from "@/modules/wati/webhook-urls";

describe("wati webhook subscription", () => {
  it("matches an existing hook for the WhatsApp number and rejects a failed create", () => {
    const url = "https://www.postbus.in/api/v1/webhooks/wati/11111111-1111-4111-8111-111111111111";
    const match = findWatiWebhook(
      [{ id: "hook-1", phoneNumber: "+917012788341", url: "https://old.example/hook" }],
      { url, phone: "917012788341" }
    );
    expect(match?.id).toBe("hook-1");
    expect(() => assertWebhookCreated({ ok: false, message: "Unknown phone number." })).toThrow(
      "Unknown phone number."
    );
  });
});

describe("wati webhook URL", () => {
  it("builds and parses the inbound path", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(watiWebhookUrl(id, "https://www.postbus.in")).toBe(
      `https://www.postbus.in/api/v1/webhooks/wati/${id}`
    );
    expect(parseWatiWebhookPath(`webhooks/wati/${id}`)).toEqual({ connectionId: id });
    expect(parseWatiWebhookPath("webhooks/shopify")).toBeNull();
  });

  it("uses the public Postbus host when the dashboard is on localhost", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(watiWebhookUrl(id, "http://localhost:3000")).toBe(
      `https://www.postbus.in/api/v1/webhooks/wati/${id}`
    );
    expect(canRegisterWatiWebhook("https://www.postbus.in")).toBe(true);
    expect(canRegisterWatiWebhook("http://localhost:3000")).toBe(true);
  });
});

describe("parseWatiWebhookEvent", () => {
  it("reads V2 template and delivery payloads", () => {
    const sent = parseWatiWebhookEvent({
      eventType: "templateMessageSent_v2",
      id: "evt-1",
      templateName: "order_confirmation",
      statusString: "SENT",
      waId: "919876543210",
    });
    expect(sent.eventType).toBe("templateMessageSent_v2");
    expect(sent.templateName).toBe("order_confirmation");
    expect(shouldNotifyWatiEvent(sent.eventType)).toBe(false);

    const failed = parseWatiWebhookEvent({
      event_type: "templateMessageFailed",
      localMessageId: "local-9",
      text: "Template rejected",
    });
    expect(failed.eventId).toBe("local-9");
    expect(shouldNotifyWatiEvent(failed.eventType)).toBe(true);
    expect(watiWebhookNotification(failed.eventType).type).toBe("wati.template_failed");
  });

  it("reads a nested event and a batch", () => {
    const nested = parseWatiWebhookEvent({
      event: { eventType: "messageReceived", id: "evt-2", waId: "917012788341" },
    });
    expect(nested.eventType).toBe("messageReceived");
    expect(nested.waId).toBe("917012788341");
    expect(parseWatiWebhookEvents([{ eventType: "message", id: "a" }, { eventType: "message", id: "b" }])).toHaveLength(
      2
    );
  });

  it("notifies incoming replies and received messages", () => {
    expect(shouldNotifyWatiEvent("messageReceived")).toBe(true);
    expect(shouldNotifyWatiEvent("sentMessageREPLIED_v2")).toBe(true);
    expect(shouldNotifyWatiEvent("templateMessageSent_v2")).toBe(false);
    expect(watiWebhookNotification("messageReceived").type).toBe("wati.message_received");
  });
});
