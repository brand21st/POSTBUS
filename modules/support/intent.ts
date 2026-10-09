import type { SupportTicketCategory, SupportWorkflowKind } from "@/types/domain";

export function classifySupportIntent(text: string): {
  category: SupportTicketCategory;
  workflowKind: SupportWorkflowKind | null;
} {
  const value = text.toLowerCase();
  if (/\bcancel/.test(value) || /रद्द|റദ്ദ്|ரத்து/.test(value)) {
    return { category: "order_cancellation", workflowKind: "cancellation" };
  }
  if (/\bexchange\b|\bwrong size\b|\bwrong colour\b|\bwrong color\b/.test(value)) {
    return { category: "product_exchange", workflowKind: "exchange" };
  }
  if (/\breturn\b|\bdamaged\b|\bbroken\b|वापसी|തിരികെ|திரும்ப/.test(value)) {
    return { category: "product_return", workflowKind: "return" };
  }
  if (/\brefund\b/.test(value)) {
    return { category: "refund_request", workflowKind: null };
  }
  return { category: "general_inquiry", workflowKind: null };
}
