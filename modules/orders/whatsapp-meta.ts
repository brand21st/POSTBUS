export type WhatsappLifecycleMeta = {
  customer_confirmed_at?: string | null;
  customer_confirmed_via?: string | null;
  customer_cancelled_at?: string | null;
  merchant_accepted_at?: string | null;
  merchant_accepted_via?: string | null;
  merchant_cancelled_at?: string | null;
  merchant_processed_at?: string | null;
  payment_required?: boolean | null;
  payment_required_amount?: number | null;
};

export type StorefrontQuoteMeta = {
  paymentPreference?: string;
  expectedAdvance?: number;
  amountOnDelivery?: number;
  total?: number;
  returnPolicy?: string;
  customer_confirmed_at?: string;
  customer_cancelled_at?: string;
  items?: Array<{
    name?: string;
    sku?: string | null;
    quantity?: number;
    unitPrice?: number;
    returnPolicy?: string;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function storefrontQuoteFromMetadata(metadata: unknown): StorefrontQuoteMeta {
  const storefront = asRecord(asRecord(metadata).storefront);
  return {
    paymentPreference: typeof storefront.paymentPreference === "string" ? storefront.paymentPreference : undefined,
    expectedAdvance: Number(storefront.expectedAdvance ?? 0),
    amountOnDelivery: Number(storefront.amountOnDelivery ?? 0),
    total: Number(storefront.total ?? 0),
    returnPolicy: typeof storefront.returnPolicy === "string" ? storefront.returnPolicy : undefined,
    customer_confirmed_at:
      typeof storefront.customer_confirmed_at === "string" ? storefront.customer_confirmed_at : undefined,
    customer_cancelled_at:
      typeof storefront.customer_cancelled_at === "string" ? storefront.customer_cancelled_at : undefined,
    items: Array.isArray(storefront.items) ? (storefront.items as StorefrontQuoteMeta["items"]) : undefined,
  };
}

function pickTimestamp(life: Record<string, unknown>, storefront: Record<string, unknown>, key: string) {
  if (typeof life[key] === "string") return life[key] as string;
  if (typeof storefront[key] === "string") return storefront[key] as string;
  return null;
}

export function whatsappLifecycleFromMetadata(metadata: unknown): WhatsappLifecycleMeta {
  const root = asRecord(metadata);
  const life = asRecord(root.whatsappLifecycle);
  const storefront = asRecord(root.storefront);
  return {
    customer_confirmed_at: pickTimestamp(life, storefront, "customer_confirmed_at"),
    customer_confirmed_via: typeof life.customer_confirmed_via === "string" ? life.customer_confirmed_via : null,
    customer_cancelled_at: pickTimestamp(life, storefront, "customer_cancelled_at"),
    merchant_accepted_at: typeof life.merchant_accepted_at === "string" ? life.merchant_accepted_at : null,
    merchant_accepted_via: typeof life.merchant_accepted_via === "string" ? life.merchant_accepted_via : null,
    merchant_cancelled_at: typeof life.merchant_cancelled_at === "string" ? life.merchant_cancelled_at : null,
    merchant_processed_at: typeof life.merchant_processed_at === "string" ? life.merchant_processed_at : null,
    payment_required: typeof life.payment_required === "boolean" ? life.payment_required : null,
    payment_required_amount:
      typeof life.payment_required_amount === "number" ? life.payment_required_amount : null,
  };
}

export function whatsappPaymentRequirement(metadata: unknown, fallbackTotal = 0) {
  const quote = storefrontQuoteFromMetadata(metadata);
  const total = Number(quote.total || fallbackTotal || 0);
  if (quote.paymentPreference === "COD") {
    const advance = Number(quote.expectedAdvance ?? 0);
    if (advance <= 0) {
      return {
        required: false as const,
        preference: "COD" as const,
        amount: 0,
        amountOnDelivery: Number(quote.amountOnDelivery || total),
      };
    }
    return {
      required: true as const,
      preference: "COD" as const,
      amount: advance,
      amountOnDelivery: Number(quote.amountOnDelivery ?? 0),
    };
  }
  if (quote.paymentPreference === "PREPAID") {
    return {
      required: true as const,
      preference: "PREPAID" as const,
      amount: total,
      amountOnDelivery: 0,
    };
  }
  return {
    required: true as const,
    preference: "UNKNOWN" as const,
    amount: total,
    amountOnDelivery: 0,
  };
}

export function mergeWhatsappLifecycle(metadata: unknown, patch: WhatsappLifecycleMeta) {
  const root = asRecord(metadata);
  const storefront = asRecord(root.storefront);
  const nextStorefront = { ...storefront };
  if (patch.customer_confirmed_at) nextStorefront.customer_confirmed_at = patch.customer_confirmed_at;
  if (patch.customer_cancelled_at) nextStorefront.customer_cancelled_at = patch.customer_cancelled_at;
  return {
    ...root,
    storefront: nextStorefront,
    whatsappLifecycle: {
      ...whatsappLifecycleFromMetadata(metadata),
      ...patch,
    },
  };
}
