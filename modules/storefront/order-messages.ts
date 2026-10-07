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

export function formatCustomerStorefrontOrderMessage(input: StorefrontOrderMessage) {
  return [
    "━━━━━━━━━━━━━━━━",
    "ORDER CONFIRMED ✅",
    "━━━━━━━━━━━━━━━━",
    "",
    "Thank you for your order!",
    "",
    "Order ID:",
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
    "",
    "ORDER STATUS",
    input.status,
    "",
    `Thank you for shopping with ${input.storeName}.`,
    "━━━━━━━━━━━━━━━━",
  ].join("\n");
}

export function formatMerchantStorefrontOrderMessage(input: StorefrontOrderMessage) {
  return [
    "━━━━━━━━━━━━━━━━",
    "🛍️ NEW ORDER",
    "━━━━━━━━━━━━━━━━",
    "",
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
    "PRODUCTS",
    "",
    itemLines(input.items),
    "",
    "PAYMENT",
    `Order Total: ${money(input.total)}`,
    `Advance: ${money(input.advanceAmount)}`,
    `COD Amount: ${money(input.codAmount)}`,
    `Payment Method: ${input.paymentMethod}`,
    "",
    "RETURN:",
    input.returnPolicy,
    "",
    "STATUS:",
    input.status,
    "",
    "━━━━━━━━━━━━━━━━",
    "",
    "Please reply with:",
    `YES ${input.orderNumber} — Process Order`,
    `NO ${input.orderNumber} — Reject Order`,
  ].join("\n");
}
