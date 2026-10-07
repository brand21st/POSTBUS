import { describe, expect, it, vi } from "vitest";
import { parseMerchantOrderAction, rejectWhatsAppOrder } from "@/modules/orders/whatsapp-merchant-action";

describe("parseMerchantOrderAction", () => {
  it("reads YES and NO with the Postbus order number", () => {
    expect(parseMerchantOrderAction("YES PB-10001")).toEqual({ action: "YES", orderNumber: "PB-10001" });
    expect(parseMerchantOrderAction("NO #PB-10002 — Reject Order")).toEqual({ action: "NO", orderNumber: "PB-10002" });
  });

  it("ignores replies that are not merchant decisions", () => {
    expect(parseMerchantOrderAction("Where is PB-10001")).toBeNull();
    expect(parseMerchantOrderAction("YES")).toBeNull();
  });
});

describe("rejectWhatsAppOrder", () => {
  it("cancels the imported WhatsApp order without deleting it", async () => {
    const updates: Record<string, unknown>[] = [];
    const audits: Record<string, unknown>[] = [];
    const client = {
      from: (table: string) => {
        const query: Record<string, unknown> = {};
        const self = () => query;
        query.update = (row: unknown) => {
          updates.push(row as Record<string, unknown>);
          return query;
        };
        query.insert = (row: unknown) => {
          audits.push(row as Record<string, unknown>);
          return query;
        };
        query.eq = self;
        query.select = self;
        query.maybeSingle = async () => ({ data: { id: "order-1", order_number: "PB-10001" }, error: null });
        return query;
      },
    };
    const result = await rejectWhatsAppOrder(client as never, "org-1", "order-1", "Merchant rejected from WhatsApp");
    expect(result.order_number).toBe("PB-10001");
    expect(updates[0]).toEqual({ status: "CANCELLED" });
    expect(audits[0]).toMatchObject({ action: "order.whatsapp_rejected", entity_id: "order-1" });
  });
});
