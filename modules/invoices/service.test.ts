import { describe, expect, it } from "vitest";
import { mapInvoice } from "@/modules/invoices/service";

describe("mapInvoice", () => {
  it("includes the customer name from the related order", () => {
    const mapped = mapInvoice({
      id: "inv-1",
      invoice_number: "INV-2026-000001",
      order_id: "ord-1",
      orders: { order_number: "#2186", customers: { name: "CLINT VARGHESE" } },
    });
    expect(mapped.customerName).toBe("CLINT VARGHESE");
    expect(mapped.customer_name).toBe("CLINT VARGHESE");
    expect(mapped.orderNumber).toBe("#2186");
  });

  it("reads a nested customer array from PostgREST", () => {
    const mapped = mapInvoice({
      id: "inv-2",
      invoice_number: "INV-2026-000002",
      orders: { order_number: "#1", customers: [{ name: "Priya Nair" }] },
    });
    expect(mapped.customerName).toBe("Priya Nair");
  });
});
