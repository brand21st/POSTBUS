import { describe, expect, it } from "vitest";
import {
  answerFromKnowledge,
  classifyAssistantIntent,
  pickOrder,
} from "@/modules/vachat/assistant";
import { formatKnowledgeDocument, type MerchantKnowledge } from "@/modules/vachat/knowledge";

const knowledge: MerchantKnowledge = {
  merchantId: "org-1",
  organization: {
    name: "AURIMO BY NISH",
    phone: "9876543210",
    website: "https://aurimo.example",
    email: "hello@aurimo.example",
    gstin: "32ABCDE1234F1Z5",
    address: "Kochi, Kerala",
  },
  orders: [
    {
      orderNumber: "1001",
      customerPhone: "8618456029",
      customerName: "Ada",
      status: "IN_TRANSIT",
      paymentStatus: "COD",
      amount: "238",
      items: ["1x Silk scarf"],
      invoiceNumber: "INV-2026-000012",
      invoiceDate: "2026-10-01",
      invoiceTotal: "238",
      trackingNumber: "CL123456789IN",
      shipmentStatus: "IN_TRANSIT",
      bookedAt: "2026-10-01T10:00:00.000Z",
      lastScan: "Item Bagged",
      lastOffice: "Ernakulam RMS",
      trackingUrl: "https://track.example/CL123456789IN",
      timeline: [{ at: "2026-10-02T08:00:00.000Z", office: "Ernakulam RMS", description: "Item Bagged" }],
    },
  ],
};

describe("PostBus WhatsApp order assistant", () => {
  it("classifies merchant, tracking, shipped, invoice, and order questions", () => {
    expect(classifyAssistantIntent("what is the merchant phone number")).toBe("merchant");
    expect(classifyAssistantIntent("where is my order now")).toBe("tracking");
    expect(classifyAssistantIntent("when shipped")).toBe("shipped");
    expect(classifyAssistantIntent("invoice number")).toBe("invoice");
    expect(classifyAssistantIntent("order details")).toBe("order");
  });

  it("answers with workspace contact details", () => {
    const reply = answerFromKnowledge(knowledge, "merchant phone number and website");
    expect(reply).toContain("AURIMO BY NISH");
    expect(reply).toContain("9876543210");
    expect(reply).toContain("https://aurimo.example");
  });

  it("answers current location from PostBus tracking only", () => {
    const reply = answerFromKnowledge(knowledge, "where is my order now");
    expect(reply).toContain("Item Bagged");
    expect(reply).toContain("Ernakulam RMS");
    expect(reply).toContain("CL123456789IN");
  });

  it("answers invoice details from this customer's order", () => {
    const reply = answerFromKnowledge(knowledge, "what is my invoice number");
    expect(reply).toContain("INV-2026-000012");
    expect(reply).toContain("1001");
  });

  it("picks an order by tracking id", () => {
    expect(pickOrder(knowledge, "track CL123456789IN")?.orderNumber).toBe("1001");
  });

  it("builds VaChat knowledge text from tenant data", () => {
    const document = formatKnowledgeDocument(knowledge);
    expect(document).toContain("Merchant name: AURIMO BY NISH");
    expect(document).toContain("Order 1001");
    expect(document).toContain("post@post.com");
    expect(document).toMatch(/read-only/i);
  });

  it("treats inbound WhatsApp text as an assistant event", async () => {
    const { isInboundAssistantEvent, parseInboundMessage } = await import("@/modules/vachat/assistant");
    expect(isInboundAssistantEvent("message.status_updated", { status: "delivered" })).toBe(false);
    expect(isInboundAssistantEvent("message.received", { from: "919876543210", text: "where is my order" })).toBe(
      true
    );
    expect(parseInboundMessage({ from: "919876543210", text: "where is my order" })).toEqual({
      from: "919876543210",
      text: "where is my order",
    });
  });
});
