import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { AI_ACCOUNTANT_SLUG } from "@/modules/addons/constants";

export type AddonCatalogRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  monthly_price_paise: number;
  yearly_price_paise: number;
  promo_monthly_price_paise: number | null;
  promo_yearly_price_paise: number | null;
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  included_assistant_questions: number;
  is_active: boolean;
  display_order: number;
};

export function catalogAmountPaise(row: AddonCatalogRow, cycle: "monthly" | "yearly", now = new Date()) {
  const promoStart = row.promo_starts_at ? new Date(row.promo_starts_at) : null;
  const promoEnd = row.promo_ends_at ? new Date(row.promo_ends_at) : null;
  const promoLive = Boolean(promoStart && promoEnd && now >= promoStart && now <= promoEnd);
  if (cycle === "yearly") {
    const promo = promoLive ? row.promo_yearly_price_paise : null;
    return Number(promo ?? row.yearly_price_paise);
  }
  const promo = promoLive ? row.promo_monthly_price_paise : null;
  return Number(promo ?? row.monthly_price_paise);
}

export async function getAddonCatalogRow(supabase: SupabaseClient, slug = AI_ACCOUNTANT_SLUG) {
  const { data, error } = await supabase.from("addon_catalog").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new AppError(ERROR_CODES.PROVIDER_ERROR, error.message);
  return (data as AddonCatalogRow | null) ?? null;
}

export async function listAddonCatalog(supabase: SupabaseClient, input?: { includeInactive?: boolean }) {
  let query = supabase.from("addon_catalog").select("*").order("display_order", { ascending: true });
  if (!input?.includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw new AppError(ERROR_CODES.PROVIDER_ERROR, error.message);
  return (data ?? []) as AddonCatalogRow[];
}

export function mapCatalog(row: AddonCatalogRow, now = new Date()) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    monthlyPricePaise: Number(row.monthly_price_paise),
    yearlyPricePaise: Number(row.yearly_price_paise),
    checkoutMonthlyPaise: catalogAmountPaise(row, "monthly", now),
    checkoutYearlyPaise: catalogAmountPaise(row, "yearly", now),
    includedAssistantQuestions: Number(row.included_assistant_questions),
    isActive: row.is_active,
    displayOrder: row.display_order,
    promo: {
      monthlyPricePaise: row.promo_monthly_price_paise,
      yearlyPricePaise: row.promo_yearly_price_paise,
      startsAt: row.promo_starts_at,
      endsAt: row.promo_ends_at,
    },
  };
}
