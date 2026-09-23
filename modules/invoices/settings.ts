import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_INVOICE_APPEARANCE,
  parseInvoiceAppearance,
  parseInvoiceSettings,
  pickStoreWebsite,
  type InvoiceAppearance,
  type InvoiceSettings,
} from "@/modules/invoices/schema";

export async function getInvoiceSettings(supabase: SupabaseClient, organizationId: string): Promise<InvoiceSettings> {
  const { data } = await supabase
    .from("invoice_settings")
    .select("appearance, gstin, business_email, website")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return parseInvoiceSettings(data);
}

export async function saveInvoiceSettings(
  supabase: SupabaseClient,
  organizationId: string,
  input: {
    appearance: InvoiceAppearance;
    gstin?: string | null;
    businessEmail?: string | null;
    website?: string | null;
  }
) {
  const appearance = parseInvoiceAppearance(input.appearance);
  const gstin = input.gstin?.trim() ? input.gstin.trim().toUpperCase() : null;
  const businessEmail = input.businessEmail?.trim() || null;
  const website = input.website === undefined ? undefined : pickStoreWebsite([input.website]) || null;
  const { error } = await supabase.from("invoice_settings").upsert({
    organization_id: organizationId,
    appearance,
    gstin,
    business_email: businessEmail,
    ...(website !== undefined ? { website } : {}),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  if (website !== undefined) {
    return { appearance, gstin, businessEmail, website };
  }
  const saved = await getInvoiceSettings(supabase, organizationId);
  return { appearance, gstin, businessEmail, website: saved.website };
}

export async function resetInvoiceAppearance(supabase: SupabaseClient, organizationId: string) {
  const current = await getInvoiceSettings(supabase, organizationId);
  return saveInvoiceSettings(supabase, organizationId, {
    appearance: DEFAULT_INVOICE_APPEARANCE,
    gstin: current.gstin,
    businessEmail: current.businessEmail,
    website: current.website,
  });
}
