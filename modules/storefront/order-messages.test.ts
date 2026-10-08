import { describe, expect, it } from "vitest";
import {
  formatCustomerCodAcceptedMessage,
  formatCustomerOrderCancelledMessage,
  formatCustomerPaymentRequiredMessage,
  formatCustomerStorefrontOrderMessage,
  formatMerchantStorefrontOrderMessage,
} from "@/modules/storefront/order-messages";

const order = {
  storeName: "Priya Stores",
  orderNumber: "#WA-PB-10001",
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
  it("puts the customer-facing order id in the ORDER RECEIVED message", () => {
    const text = formatCustomerStorefrontOrderMessage(order);
    expect(text).toContain("ORDER RECEIVED");
    expect(text).toContain("🛍️");
    expect(text).not.toContain("ORDER CONFIRMED");
    expect(text).not.toContain("PAYMENT CONFIRMED");
    expect(text).not.toContain("READY");
    expect(text).not.toContain("SHIPPED");
    expect(text).toContain("YES #WA-PB-10001");
    expect(text).toContain("NO #WA-PB-10001");
    expect(text).toContain("Your order has been received successfully.");
    expect(text).toContain("9876543210");
    expect(text).toContain("No Return");
    expect(text).toContain("COD with advance");
  });

  it("asks the merchant to PROCESS or CANCEL only after customer confirmation", () => {
    const text = formatMerchantStorefrontOrderMessage(order);
    expect(text).toContain("NEW ORDER");
    expect(text).toContain("PROCESS #WA-PB-10001");
    expect(text).toContain("CANCEL #WA-PB-10001");
    expect(text).toContain("Customer has confirmed this order.");
    expect(text).toContain("Rahul");
    expect(text).toContain("Nadakkavu");
  });

  it("tells the customer when they cancel", () => {
    expect(formatCustomerOrderCancelledMessage("#WA-PB-10001")).toContain("ORDER CANCELLED");
    expect(formatCustomerOrderCancelledMessage("#WA-PB-10001")).toContain("#WA-PB-10001");
  });

  it("confirms COD acceptance without payment instructions", () => {
    const text = formatCustomerCodAcceptedMessage("PB-11143");
    expect(text).toContain("ORDER CONFIRMED");
    expect(text).toContain("Cash on Delivery");
    expect(text).not.toContain("UPI");
    expect(text).not.toContain("I HAVE PAID");
  });

  it("sends payment instructions without claiming the order is paid", () => {
    const text = formatCustomerPaymentRequiredMessage({
      orderNumber: "#WA-PB-11143",
      amount: 500,
      upiId: "priya@upi",
      gpay: "8618456029",
    });
    expect(text).toContain("ORDER CONFIRMED");
    expect(text).toContain("WhatsApp order Id:");
    expect(text).toContain("#WA-PB-11143");
    expect(text).toContain("Amount to Pay");
    expect(text).toContain("500");
    expect(text).toContain("priya@upi");
    expect(text).toContain("8618456029");
    expect(text).toContain("I HAVE PAID #WA-PB-11143");
    expect(text).not.toContain("PAYMENT RECEIVED");
    expect(text).not.toContain("PAYMENT CONFIRMED");
  });

  it("still works when only the amount is configured", () => {
    const text = formatCustomerPaymentRequiredMessage({ orderNumber: "#WA-PB-11143", amount: 2000 });
    expect(text).toContain("I HAVE PAID #WA-PB-11143");
    expect(text).not.toContain("UPI:\n");
  });
});
