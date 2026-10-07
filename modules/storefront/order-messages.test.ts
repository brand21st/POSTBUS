import { describe, expect, it } from "vitest";
import {
  formatCustomerStorefrontOrderMessage,
  formatMerchantStorefrontOrderMessage,
} from "@/modules/storefront/order-messages";

const order = {
  storeName: "Priya Stores",
  orderNumber: "PB-10001",
  customerName: "Rahul",
  whatsapp: "9876543210",
  line1: "12 ABC House",
  line2: "Nadakkavu",
  city: "Kozhikode",
  state: "Kerala",
  pincode: "673001",
  items: [{ name: "Premium T-Shirt", sku: "TSHIRT-001", quantity: 1, unitPrice: 1000, returnPolicy: "No Return" }],
  total: 1000,
  advanceAmount: 200,
  codAmount: 800,
  paymentMethod: "COD with advance",
  returnPolicy: "No Return",
  status: "Processing",
};

describe("storefront WhatsApp order messages", () => {
  it("puts the customer-facing order id in the customer confirmation", () => {
    const text = formatCustomerStorefrontOrderMessage(order);
    expect(text).toContain("PB-10001");
    expect(text).toContain("9876543210");
    expect(text).toContain("No Return");
    expect(text).toContain("COD with advance");
    expect(text).not.toContain("order-uuid");
  });

  it("asks the merchant to reply YES or NO with the same order id", () => {
    const text = formatMerchantStorefrontOrderMessage(order);
    expect(text).toContain("YES PB-10001");
    expect(text).toContain("NO PB-10001");
    expect(text).toContain("Nadakkavu");
  });
});
