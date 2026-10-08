import { canonicalOrderNumber } from "@/modules/orders/order-number";

const ORDER_TOKEN = /((?:WA-)?PB-\d+)/i;
const ORDER_REF = new RegExp(`(?:#?\\s*)?${ORDER_TOKEN.source}`, "i");
const COLON_ORDER = new RegExp(
  `^(?:yes|no|process|cancel|paid|i-have-paid|confirm-payment|reject-payment):?\\s*#?\\s*${ORDER_TOKEN.source}`,
  "i"
);

export type WhatsAppOrderCommandKind =
  | "CUSTOMER_YES"
  | "CUSTOMER_NO"
  | "MERCHANT_PROCESS"
  | "MERCHANT_CANCEL"
  | "PAYMENT_CLAIM"
  | "PAYMENT_CONFIRM"
  | "PAYMENT_REJECT";

export type WhatsAppOrderCommand = {
  kind: WhatsAppOrderCommandKind;
  orderNumber: string;
};

function orderNumberFrom(raw: string) {
  const colon = raw.match(COLON_ORDER);
  if (colon?.[1]) return canonicalOrderNumber(colon[1]);
  const match = raw.match(ORDER_REF);
  return match?.[1] ? canonicalOrderNumber(match[1]) : null;
}

export function parseWhatsAppOrderCommand(text: string): WhatsAppOrderCommand | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const orderNumber = orderNumberFrom(raw);
  if (!orderNumber) return null;

  if (/^(?:i have paid|paid|payment done)\b/i.test(raw) || /^paid:/i.test(raw) || /^i-have-paid:/i.test(raw)) {
    return { kind: "PAYMENT_CLAIM", orderNumber };
  }
  if (/^confirm(?:\s+payment)?\b/i.test(raw) || /^confirm-payment:/i.test(raw)) {
    return { kind: "PAYMENT_CONFIRM", orderNumber };
  }
  if (/^reject(?:\s+payment)?\b/i.test(raw) || /^reject-payment:/i.test(raw)) {
    return { kind: "PAYMENT_REJECT", orderNumber };
  }
  if (/^(?:process)\b/i.test(raw) || /^process:/i.test(raw)) {
    return { kind: "MERCHANT_PROCESS", orderNumber };
  }
  if (/^(?:cancel)\b/i.test(raw) || /^cancel:/i.test(raw)) {
    return { kind: "MERCHANT_CANCEL", orderNumber };
  }
  if (/^\s*(yes|y|✅)\b/i.test(raw) || /^yes:/i.test(raw)) {
    return { kind: "CUSTOMER_YES", orderNumber };
  }
  if (/^\s*(no|n|❌)\b/i.test(raw) || /^no:/i.test(raw)) {
    return { kind: "CUSTOMER_NO", orderNumber };
  }
  return null;
}

export function isWhatsAppOrderCommand(text: string) {
  return parseWhatsAppOrderCommand(text) != null;
}

export function yesNoInteractive(orderNumber: string) {
  const stored = canonicalOrderNumber(orderNumber);
  return {
    type: "button",
    body: { text: "Please confirm your order." },
    action: {
      buttons: [
        { type: "reply", reply: { id: `yes:${stored}`, title: "YES" } },
        { type: "reply", reply: { id: `no:${stored}`, title: "NO" } },
      ],
    },
  };
}

export function processCancelInteractive(orderNumber: string) {
  const stored = canonicalOrderNumber(orderNumber);
  return {
    type: "button",
    body: { text: "Customer has confirmed this order." },
    action: {
      buttons: [
        { type: "reply", reply: { id: `process:${stored}`, title: "PROCESS" } },
        { type: "reply", reply: { id: `cancel:${stored}`, title: "CANCEL" } },
      ],
    },
  };
}

export function iHavePaidInteractive(orderNumber: string) {
  const stored = canonicalOrderNumber(orderNumber);
  return {
    type: "button",
    body: { text: "After paying, tap I HAVE PAID." },
    action: {
      buttons: [{ type: "reply", reply: { id: `paid:${stored}`, title: "I HAVE PAID" } }],
    },
  };
}

export function paymentVerifyInteractive(orderNumber: string) {
  const stored = canonicalOrderNumber(orderNumber);
  return {
    type: "button",
    body: { text: "Customer says payment is completed." },
    action: {
      buttons: [
        { type: "reply", reply: { id: `confirm-payment:${stored}`, title: "CONFIRM PAY" } },
        { type: "reply", reply: { id: `reject-payment:${stored}`, title: "REJECT PAY" } },
      ],
    },
  };
}
