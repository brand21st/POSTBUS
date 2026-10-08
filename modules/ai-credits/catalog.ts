import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import {
  DEFAULT_AI_CREDIT_CUSTOM_MAX,
  DEFAULT_AI_CREDIT_CUSTOM_MIN,
  DEFAULT_AI_CREDIT_PACKAGES,
  DEFAULT_AI_CREDIT_PACK_PAISE,
  DEFAULT_AI_CREDIT_PACK_SIZE,
} from "@/modules/ai-credits/constants";
import { normalizeCreditLimits, type QuotePackage } from "@/modules/ai-credits/quote";

export type AiCreditPackage = QuotePackage & {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  isRecommended: boolean;
  displayOrder: number;
};

export type AiCreditCatalog = {
  packages: AiCreditPackage[];
  custom: { min: number; max: number };
};

const FALLBACK_PACKAGES: AiCreditPackage[] = DEFAULT_AI_CREDIT_PACKAGES.map((item) => ({
  id: `fallback-${item.slug}`,
  slug: item.slug,
  name: item.name,
  credits: item.credits,
  pricePaise: item.pricePaise,
  isActive: true,
  isRecommended: item.isRecommended,
  displayOrder: item.displayOrder,
}));

function asInt(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export function mapAiCreditPackage(row: Record<string, unknown>): AiCreditPackage {
  return {
    id: String(row.id ?? ""),
    slug: String(row.slug ?? ""),
    name: String(row.name ?? ""),
    credits: Math.max(1, asInt(row.credits, DEFAULT_AI_CREDIT_PACK_SIZE)),
    pricePaise: Math.max(100, asInt(row.price_paise ?? row.pricePaise, DEFAULT_AI_CREDIT_PACK_PAISE)),
    isActive: row.is_active !== false && row.isActive !== false,
    isRecommended: Boolean(row.is_recommended ?? row.isRecommended),
    displayOrder: asInt(row.display_order ?? row.displayOrder, 0),
  };
}

export function publicAiCreditPackage(pack: AiCreditPackage) {
  return {
    id: pack.id,
    slug: pack.slug,
    name: pack.name,
    credits: pack.credits,
    pricePaise: pack.pricePaise,
    isRecommended: pack.isRecommended,
    displayOrder: pack.displayOrder,
  };
}

export async function loadAiCreditCatalog(options?: { includeInactive?: boolean }): Promise<AiCreditCatalog> {
  if (!hasAdminClient()) {
    return {
      packages: FALLBACK_PACKAGES,
      custom: { min: DEFAULT_AI_CREDIT_CUSTOM_MIN, max: DEFAULT_AI_CREDIT_CUSTOM_MAX },
    };
  }
  const supabase = createAdminClient();
  const packagesQuery = supabase
    .from("ai_credit_packages")
    .select("id, slug, name, credits, price_paise, is_active, is_recommended, display_order")
    .order("display_order", { ascending: true });
  const [packagesResult, settingsResult] = await Promise.all([
    options?.includeInactive ? packagesQuery : packagesQuery.eq("is_active", true),
    supabase
      .from("platform_settings")
      .select("ai_credit_custom_min, ai_credit_custom_max")
      .eq("id", 1)
      .maybeSingle(),
  ]);
  if (packagesResult.error) {
    logError("ai_credits.packages_load_failed", { message: packagesResult.error.message });
  }
  const rows = (packagesResult.data ?? []) as Array<Record<string, unknown>>;
  const packages = rows.map(mapAiCreditPackage).filter((item) => item.id);
  const custom = normalizeCreditLimits({
    min: asInt(settingsResult.data?.ai_credit_custom_min, DEFAULT_AI_CREDIT_CUSTOM_MIN),
    max: asInt(settingsResult.data?.ai_credit_custom_max, DEFAULT_AI_CREDIT_CUSTOM_MAX),
  });
  return {
    packages: packages.length ? packages : FALLBACK_PACKAGES,
    custom,
  };
}
