import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  DEFAULT_AI_CREDIT_CUSTOM_MAX,
  DEFAULT_AI_CREDIT_CUSTOM_MIN,
} from "@/modules/ai-credits/constants";

export type QuotePackage = {
  id?: string | null;
  credits: number;
  pricePaise: number;
  isActive?: boolean;
};

export type CustomCreditLimits = {
  min: number;
  max: number;
};

export type AiCreditQuote = {
  credits: number;
  amountPaise: number;
  perCreditPaise: number;
  perCreditRupees: number;
  packageId: string | null;
};

export function normalizeCreditLimits(input?: Partial<CustomCreditLimits> | null): CustomCreditLimits {
  const min = Math.max(1, Math.floor(Number(input?.min) || DEFAULT_AI_CREDIT_CUSTOM_MIN));
  const max = Math.max(min, Math.floor(Number(input?.max) || DEFAULT_AI_CREDIT_CUSTOM_MAX));
  return { min, max };
}

export function activeQuotePackages(packages: QuotePackage[]) {
  return packages
    .filter((item) => item.isActive !== false && item.credits > 0 && item.pricePaise > 0)
    .slice()
    .sort((a, b) => a.credits - b.credits);
}

export function quoteAiCredits(
  rawCredits: unknown,
  packages: QuotePackage[],
  limits?: Partial<CustomCreditLimits> | null,
  packageId?: string | null
): AiCreditQuote {
  const { min, max } = normalizeCreditLimits(limits);
  const sorted = activeQuotePackages(packages);

  if (packageId) {
    const pack = sorted.find((item) => item.id === packageId);
    if (!pack) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "That AI credit package is not available.");
    }
    return toQuote(pack.credits, pack.pricePaise, pack.id ?? null);
  }

  if (typeof rawCredits === "number" && !Number.isInteger(rawCredits)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a whole number of AI credits.");
  }
  const credits = Math.floor(Number(rawCredits));
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a valid number of AI credits.");
  }
  if (credits < min || credits > max) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `Choose between ${min.toLocaleString("en-IN")} and ${max.toLocaleString("en-IN")} credits.`
    );
  }

  const exact = sorted.find((item) => item.credits === credits);
  if (exact) return toQuote(credits, exact.pricePaise, exact.id ?? null);

  if (sorted.length === 0) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "AI credit packages are not configured yet.");
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (credits <= first.credits) {
    return toQuote(credits, proportionalPaise(first.pricePaise, first.credits, credits), null);
  }
  if (credits >= last.credits) {
    return toQuote(credits, proportionalPaise(last.pricePaise, last.credits, credits), null);
  }

  let lower = first;
  let upper = last;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (sorted[i].credits <= credits && sorted[i + 1].credits >= credits) {
      lower = sorted[i];
      upper = sorted[i + 1];
      break;
    }
  }
  const span = upper.credits - lower.credits;
  const t = span === 0 ? 0 : (credits - lower.credits) / span;
  const amountPaise = Math.round(lower.pricePaise + t * (upper.pricePaise - lower.pricePaise));
  return toQuote(credits, Math.max(100, amountPaise), null);
}

function proportionalPaise(pricePaise: number, packCredits: number, credits: number) {
  return Math.max(100, Math.round((pricePaise / packCredits) * credits));
}

function toQuote(credits: number, amountPaise: number, packageId: string | null): AiCreditQuote {
  const paise = Math.max(100, Math.floor(amountPaise));
  return {
    credits,
    amountPaise: paise,
    perCreditPaise: paise / credits,
    perCreditRupees: paise / credits / 100,
    packageId,
  };
}
