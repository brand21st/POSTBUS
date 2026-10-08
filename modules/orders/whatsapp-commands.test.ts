import { describe, expect, it } from "vitest";
import { parseWhatsAppOrderCommand, yesNoInteractive } from "@/modules/orders/whatsapp-commands";

describe("parseWhatsAppOrderCommand", () => {
  it("requires the canonical order number", () => {
    expect(parseWhatsAppOrderCommand("YES")).toBeNull();
    expect(parseWhatsAppOrderCommand("NO")).toBeNull();
    expect(parseWhatsAppOrderCommand("PROCESS")).toBeNull();
    expect(parseWhatsAppOrderCommand("CANCEL")).toBeNull();
  });

  it("parses customer and merchant commands", () => {
    expect(parseWhatsAppOrderCommand("YES PB-11143")).toEqual({ kind: "CUSTOMER_YES", orderNumber: "PB-11143" });
    expect(parseWhatsAppOrderCommand("YES #WA-PB-10001")).toEqual({ kind: "CUSTOMER_YES", orderNumber: "WA-PB-10001" });
    expect(parseWhatsAppOrderCommand("yes:WA-PB-10001")).toEqual({ kind: "CUSTOMER_YES", orderNumber: "WA-PB-10001" });
    expect(parseWhatsAppOrderCommand("yes:PB-11143")).toEqual({ kind: "CUSTOMER_YES", orderNumber: "PB-11143" });
    expect(parseWhatsAppOrderCommand("NO PB-11143")).toEqual({ kind: "CUSTOMER_NO", orderNumber: "PB-11143" });
    expect(parseWhatsAppOrderCommand("PROCESS PB-11143")).toEqual({ kind: "MERCHANT_PROCESS", orderNumber: "PB-11143" });
    expect(parseWhatsAppOrderCommand("CANCEL PB-11143")).toEqual({ kind: "MERCHANT_CANCEL", orderNumber: "PB-11143" });
  });

  it("parses payment claim and verification commands", () => {
    expect(parseWhatsAppOrderCommand("I HAVE PAID PB-11143")).toEqual({
      kind: "PAYMENT_CLAIM",
      orderNumber: "PB-11143",
    });
    expect(parseWhatsAppOrderCommand("paid:PB-11143")).toEqual({ kind: "PAYMENT_CLAIM", orderNumber: "PB-11143" });
    expect(parseWhatsAppOrderCommand("CONFIRM PAYMENT PB-11143")).toEqual({
      kind: "PAYMENT_CONFIRM",
      orderNumber: "PB-11143",
    });
    expect(parseWhatsAppOrderCommand("REJECT PAYMENT PB-11143")).toEqual({
      kind: "PAYMENT_REJECT",
      orderNumber: "PB-11143",
    });
    expect(parseWhatsAppOrderCommand("I HAVE PAID")).toBeNull();
    expect(parseWhatsAppOrderCommand("I HAVE PAID #WA-PB-10001")).toEqual({
      kind: "PAYMENT_CLAIM",
      orderNumber: "WA-PB-10001",
    });
  });

  it("keeps interactive button ids without a hash prefix", () => {
    expect(yesNoInteractive("#WA-PB-10001").action.buttons[0]?.reply.id).toBe("yes:WA-PB-10001");
  });
});
