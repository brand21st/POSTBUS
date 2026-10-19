import type { SupabaseClient } from "@supabase/supabase-js";
import { gstinStateCode } from "@/modules/ai-accountant/gst";

export type BooksContext = {
  gstRegistered: boolean;
  merchantState: string | null;
  taxInclusive: boolean;
  defaultRateBps: number;
  booksStartDate: string | null;
};

export async function loadBooksContext(supabase: SupabaseClient, organizationId: string): Promise<BooksContext> {
  const [{ data: settings }, { data: registration }] = await Promise.all([
    supabase.from("accounting_settings").select("*").eq("organization_id", organizationId).maybeSingle(),
    supabase
      .from("gst_registrations")
      .select("gstin, state_code")
      .eq("organization_id", organizationId)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    gstRegistered: Boolean(settings?.gst_registered && registration?.gstin),
    merchantState: registration?.state_code ?? gstinStateCode(registration?.gstin) ?? null,
    taxInclusive: settings?.tax_inclusive !== false,
    defaultRateBps: Number(settings?.default_rate_bps ?? 0),
    booksStartDate: settings?.books_start_date ?? null,
  };
}
