import { formatStorePrice } from "@/modules/storefront/pricing";

export type StorefrontOrderMessageLine = {
  name: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  returnPolicy: string;
};

export type StorefrontOrderMessage = {
  storeName: string;
  orderNumber: string;
  customerName: string;
  whatsapp: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  items: StorefrontOrderMessageLine[];
  total: number;
  advanceAmount: number;
  codAmount: number;
  paymentMethod: string;
  returnPolicy: string;
  status: string;
};

function money(value: number) {
  return formatStorePrice(value);
}

function deliveryBlock(input: StorefrontOrderMessage) {
  return [input.line1, input.line2, `${input.city}, ${input.state} - ${input.pincode}`]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n");
}

function itemLines(items: StorefrontOrderMessageLine[]) {
  return items
    .map((item, index) => {
      const sku = item.sku?.trim() ? `SKU: ${item.sku.trim()}\n` : "";
      return `${index + 1}. ${item.name}\n${sku}Qty: ${item.quantity}\nPrice: ${money(item.unitPrice * item.quantity)}\nReturn: ${item.returnPolicy}`;
    })
    .join("\n\n");
}

function orderBody(input: StorefrontOrderMessage) {
  return [
    "Order:",
    input.orderNumber,
    "",
    "CUSTOMER",
    `Name: ${input.customerName}`,
    `WhatsApp: ${input.whatsapp}`,
    "",
    "DELIVERY",
    deliveryBlock(input),
    "",
    "ORDER ITEMS",
    "",
    itemLines(input.items),
    "",
    "PAYMENT",
    `Order Total: ${money(input.total)}`,
    `Advance: ${money(input.advanceAmount)}`,
    `COD Amount: ${money(input.codAmount)}`,
    `Payment Method: ${input.paymentMethod}`,
    "",
    "RETURN POLICY",
    input.returnPolicy,
  ];
}

export function formatCustomerStorefrontOrderMessage(input: StorefrontOrderMessage) {
  return [
    "🛍️ ORDER RECEIVED",
    "",
    `Order: ${input.orderNumber}`,
    "",
    "Your order has been received successfully.",
    "",
    ...orderBody(input),
    "",
    "Please confirm your order:",
    `YES ${input.orderNumber}`,
    `NO ${input.orderNumber}`,
    "",
    `Thank you for shopping with ${input.storeName}.`,
  ].join("\n");
}

export function formatCustomerOrderConfirmedMessage(orderNumber: string) {
  return [
    "Thank you.",
    "",
    `Your confirmation for ${orderNumber} has been recorded.`,
    "The merchant will process your order.",
  ].join("\n");
}

export function formatCustomerOrderCancelledMessage(orderNumber: string) {
  return ["❌ ORDER CANCELLED", "", `Your order ${orderNumber} has been cancelled as requested.`].join("\n");
}

export function formatCustomerCodAcceptedMessage(orderNumber: string) {
  return [
    "🛍️ ORDER CONFIRMED",
    "",
    `Your order ${orderNumber} has been accepted by the merchant.`,
    "Payment: Cash on Delivery",
    "We’ll proceed with shipping shortly.",
  ].join("\n");
}

export function formatCustomerPaymentRequiredSoonMessage(orderNumber: string, amount: number) {
  return [
    "🛍️ ORDER CONFIRMED",
    "",
    `Your order ${orderNumber} has been accepted.`,
    `Payment required: ${money(amount)}`,
    "Payment instructions will be provided shortly.",
  ].join("\n");
}

export function formatCustomerPaymentRequiredMessage(input: {
  orderNumber: string;
  amount: number;
  upiId?: string | null;
  gpay?: string | null;
}) {
  return [
    "🛍️ ORDER CONFIRMED",
    "",
    "WhatsApp order Id:",
    input.orderNumber,
    "",
    "Amount to Pay:",
    money(input.amount),
    "",
    "Payment method:",
    input.upiId ? `UPI:\n${input.upiId}` : null,
    input.gpay ? `GPay:\n${input.gpay}` : null,
    "",
    "This is a payment request. The order is not marked paid yet.",
    "After making the payment, reply:",
    `I HAVE PAID ${input.orderNumber}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function formatCustomerPaymentClaimedMessage(orderNumber: string) {
  return [
    "⏳ PAYMENT SUBMITTED",
    "",
    `Your payment claim for ${orderNumber} has been sent to the merchant.`,
  ].join("\n");
}

export function formatCustomerPaymentAlreadySubmittedMessage(orderNumber: string) {
  return [
    "⏳ PAYMENT ALREADY SUBMITTED",
    "",
    `Your payment claim for ${orderNumber} is already awaiting merchant verification.`,
  ].join("\n");
}

export function formatMerchantPaymentClaimedMessage(input: {
  orderNumber: string;
  customerName: string;
  amount: number;
}) {
  return [
    "💰 PAYMENT CLAIM",
    "",
    "Order:",
    input.orderNumber,
    "",
    "Customer:",
    input.customerName || "Customer",
    "",
    "Amount:",
    money(input.amount),
    "",
    "The customer says the payment has been completed.",
    "Please verify the payment independently, then reply:",
    `CONFIRM PAYMENT ${input.orderNumber}`,
    `REJECT PAYMENT ${input.orderNumber}`,
  ].join("\n");
}

export function formatCustomerPaymentConfirmedMessage(orderNumber: string) {
  return [
    "✅ PAYMENT CONFIRMED",
    "",
    `Your order ${orderNumber} is confirmed for shipping.`,
  ].join("\n");
}

export function formatCustomerPaymentRejectedMessage(orderNumber: string) {
  return [
    "❌ PAYMENT NOT VERIFIED",
    "",
    `Your payment claim for ${orderNumber} could not be verified.`,
    "Please contact the merchant or submit payment again.",
  ].join("\n");
}

export function formatMerchantStorefrontOrderMessage(input: StorefrontOrderMessage) {
  return [
    "🛍️ NEW ORDER",
    "",
    `Order: ${input.orderNumber}`,
    "",
    `Customer: ${input.customerName}`,
    "",
    ...orderBody(input),
    "",
    `Total: ${money(input.total)}`,
    "",
    "Customer has confirmed this order.",
    "",
    `PROCESS ${input.orderNumber}`,
    `CANCEL ${input.orderNumber}`,
  ].join("\n");
}
