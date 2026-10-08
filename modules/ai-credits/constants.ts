export const DEFAULT_AI_CREDIT_START = 500;
export const DEFAULT_AI_CREDIT_PACK_SIZE = 500;
export const DEFAULT_AI_CREDIT_PACK_PAISE = 9900;
export const AI_CREDITS_BILLING_CYCLE = "ai_credits";
export const AI_CREDIT_REASON_EXTRACTION = "AI_ADDRESS_EXTRACTION";
export const AI_CREDIT_TYPE_PURCHASE = "PURCHASE";
export const AI_CREDIT_LOW_BALANCE = 25;
export const DEFAULT_AI_CREDIT_CUSTOM_MIN = 500;
export const DEFAULT_AI_CREDIT_CUSTOM_MAX = 10000;
export const ZERO_AI_CREDITS_MESSAGE = "You're out of AI Credits.";

export const DEFAULT_AI_CREDIT_PACKAGES = [
  { slug: "starter", name: "Starter", credits: 500, pricePaise: 9900, isRecommended: false, displayOrder: 10 },
  { slug: "growth", name: "Growth", credits: 1000, pricePaise: 17900, isRecommended: false, displayOrder: 20 },
  { slug: "pro", name: "Pro", credits: 2500, pricePaise: 39900, isRecommended: true, displayOrder: 30 },
  { slug: "business", name: "Business", credits: 5000, pricePaise: 69900, isRecommended: false, displayOrder: 40 },
  { slug: "scale", name: "Scale", credits: 10000, pricePaise: 119900, isRecommended: false, displayOrder: 50 },
] as const;
