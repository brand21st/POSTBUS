import { afterEach, describe, expect, it, vi } from "vitest";
import { isInboundAssistantEvent, parseInboundMessage, resolveInboundSender } from "@/modules/vachat/inbound";
import { composeRetrievedReply } from "@/modules/vachat/retrieve";

vi.mock("@/modules/vachat/platform-config", () => ({
  getPlatformVachatConfig: vi.fn(async () => ({
    enabled: true,
    apiKey: "key",
    apiBaseUrl: "https://cloud.vachat.in",
  })),
  isPlatformVachatActive: () => true,
}));

describe("VaChat inbound payload (WACRM message.received)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads text from the real WACRM webhook data shape", () => {
    const data = {
      conversation_id: "conv-1",
      contact_id: "ctc-1",
      whatsapp_message_id: "wamid.1",
      message_id: "wamid.1",
      channel: "whatsapp",
      content_type: "text",
      text: "Where is my order",
    };
    expect(isInboundAssistantEvent("message.received", data)).toBe(true);
    expect(parseInboundMessage(data)).toEqual({
      from: "",
      text: "Where is my order",
      contactId: "ctc-1",
      conversationId: "conv-1",
    });
  });

  it("resolves the sender phone from contact_id when from is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { phone: "+918848772371" } }),
      }))
    );
    const inbound = await resolveInboundSender({
      contact_id: "ctc-1",
      text: "Invoice number and amount pls",
    });
    expect(inbound.from).toBe("+918848772371");
    expect(inbound.text).toBe("Invoice number and amount pls");
  });
});

describe("grounded retrieval replies", () => {
  it("leads with invoice facts when the customer asks for invoice amount", () => {
    const reply = composeRetrievedReply("Invoice number and amount pls", [
      { kind: "order", text: "Zoura Parfums order PB-10948 is in transit." },
      { kind: "invoice", text: "Invoice INV-12. Amount 238." },
      { kind: "tracking", text: "India Post tracking ID TRACKING-A." },
    ]);
    expect(reply.startsWith("Invoice INV-12.")).toBe(true);
    expect(reply).toContain("Amount 238");
    expect(reply).toContain("PB-10948");
  });
});
