import { describe, expect, it } from "vitest";
import {
  CUSTOMER_PHONE_ONLY_REPLY,
  customerPhonesMatch,
  filterKnowledgeOrdersForPhone,
  formatKnowledgeDocument,
  type MerchantKnowledge,
} from "@/modules/vachat/knowledge";
import { answerFromKnowledge, looksLikeOrderOrTrackingQuery, pickOrder } from "@/modules/vachat/assistant";

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
      timeline: [
        { at: "2026-10-02T08:00:00.000Z", office: "Ernakulam RMS", description: "Item Bagged" },
        { at: "2026-10-01T10:00:00.000Z", office: "Kochi HO", description: "Item Booked" },
      ],
    },
  ],
};

describe("VaChat knowledge phone scope", () => {
  it("matches Indian WhatsApp numbers with or without country code", () => {
    expect(customerPhonesMatch("+918618456029", "8618456029")).toBe(true);
    expect(customerPhonesMatch("8618456029", "9999999999")).toBe(false);
  });

  it("keeps only orders for the sender WhatsApp number", () => {
    const mixed = [
      knowledge.orders[0],
      { ...knowledge.orders[0], orderNumber: "1002", customerPhone: "9999999999", trackingNumber: "XX111111111IN" },
    ];
    expect(filterKnowledgeOrdersForPhone(mixed, "918618456029").map((row) => row.orderNumber)).toEqual(["1001"]);
  });

  it("refuses another customer's tracking id", () => {
    expect(looksLikeOrderOrTrackingQuery("track XX111111111IN")).toBe(true);
    expect(pickOrder(knowledge, "track XX111111111IN")).toBeNull();
    expect(answerFromKnowledge(knowledge, "track XX111111111IN")).toBe(CUSTOMER_PHONE_ONLY_REPLY);
  });

  it("includes invoice, shipment, and tracking timeline in the VaChat knowledge document", () => {
    const document = formatKnowledgeDocument(knowledge);
    expect(document).toContain("post@post.com");
    expect(document).toContain("Customer WhatsApp 8618456029");
    expect(document).toContain("India Post tracking ID CL123456789IN");
    expect(document).toContain("INV-2026-000012");
    expect(document).toContain("Item Booked");
    expect(document).toMatch(/Never share another customer's/i);
  });
});
