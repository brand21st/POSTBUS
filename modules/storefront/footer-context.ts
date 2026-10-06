import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleStoreFooter, normalizeStorefrontFooterConfig, type StoreFooter } from "@/modules/storefront/footer";
import { loadOrganizationPolicies } from "@/modules/vachat/policies";

export async function loadStoreFooterContext(supabase: SupabaseClient, organizationId: string) {
  const [{ data: org }, { data: invoice }, policies, { data: products }] = await Promise.all([
    supabase
      .from("organizations")
      .select("name, phone, line1, line2, city, state, pincode")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("invoice_settings")
      .select("business_email")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    loadOrganizationPolicies(supabase, organizationId),
    supabase
      .from("products")
      .select("prepaid_enabled, cod_enabled, cod_advance_percent")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .eq("store_visible", true)
      .limit(80),
  ]);
  const rows = products ?? [];
  return {
    organization: org
      ? {
          name: typeof org.name === "string" ? org.name : null,
          phone: typeof org.phone === "string" ? org.phone : null,
          line1: typeof org.line1 === "string" ? org.line1 : null,
          line2: typeof org.line2 === "string" ? org.line2 : null,
          city: typeof org.city === "string" ? org.city : null,
          state: typeof org.state === "string" ? org.state : null,
          pincode: typeof org.pincode === "string" ? org.pincode : null,
        }
      : null,
    email: typeof invoice?.business_email === "string" ? invoice.business_email.trim() || null : null,
    policies,
    payments: {
      prepaid: rows.some((row) => Boolean(row.prepaid_enabled)),
      cod: rows.some((row) => Boolean(row.cod_enabled)),
      partial: rows.some((row) => Boolean(row.cod_enabled) && Number(row.cod_advance_percent ?? 0) > 0),
    },
  };
}

export async function buildStoreFooter(
  supabase: SupabaseClient,
  organizationId: string,
  input: {
    footer: unknown;
    storeName: string;
    logoUrl: string | null;
    tagline: string | null;
    accentColor: string;
    workspace: string;
    categories: Array<{ name: string; slug: string }>;
    hasProducts: boolean;
    hasBestSellers: boolean;
  }
): Promise<StoreFooter | null> {
  const context = await loadStoreFooterContext(supabase, organizationId);
  return assembleStoreFooter(normalizeStorefrontFooterConfig(input.footer), {
    storeName: input.storeName,
    logoUrl: input.logoUrl,
    tagline: input.tagline,
    accentColor: input.accentColor,
    workspace: input.workspace,
    organization: context.organization,
    email: context.email,
    policies: context.policies,
    categories: input.categories,
    hasProducts: input.hasProducts,
    hasBestSellers: input.hasBestSellers,
    payments: context.payments,
  });
}
