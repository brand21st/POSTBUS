import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { gstinStateCode } from "@/modules/ai-accountant/gst";

export const settingsSchema = z.object({
  taxInclusive: z.boolean().optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  gstRegistered: z.boolean().optional(),
  gstin: z.string().trim().max(15).optional(),
  legalName: z.string().trim().max(160).optional(),
  costsAcknowledged: z.boolean().optional(),
  defaultRateBps: z.number().int().min(0).max(4000).nullable().optional(),
  defaultHsn: z.string().trim().regex(/^\d{4,8}$/, "HSN/SAC must be 4 to 8 digits.").nullable().optional(),
  booksStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function loadAccountingWorkspace(supabase: SupabaseClient, organizationId: string) {
  const [{ data: settings }, { data: registration }, { data: costs }] = await Promise.all([
    supabase.from("accounting_settings").select("*").eq("organization_id", organizationId).maybeSingle(),
    supabase
      .from("gst_registrations")
      .select("*")
      .eq("organization_id", organizationId)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("product_costs").select("id").eq("organization_id", organizationId).limit(1),
  ]);
  const gstReady = settings?.gst_registered === false || Boolean(registration?.gstin);
  const costsReady = Boolean(costs?.length) || Boolean(settings?.costs_acknowledged);
  return {
    settings,
    registration,
    setup: {
      gstReady,
      costsReady,
      complete: Boolean(settings?.setup_completed) && gstReady,
      booksAccurate: gstReady && costsReady,
    },
  };
}

export async function saveAccountingSettings(
  supabase: SupabaseClient,
  organizationId: string,
  raw: unknown
) {
  const body = settingsSchema.parse(raw);
  // Only fields present in the request change; omitted fields keep their stored value.
  const patch: Record<string, unknown> = { organization_id: organizationId, setup_completed: true, updated_at: new Date().toISOString() };
  if (body.taxInclusive !== undefined) patch.tax_inclusive = body.taxInclusive;
  if (body.fiscalYearStartMonth !== undefined) patch.fiscal_year_start_month = body.fiscalYearStartMonth;
  if (body.gstRegistered !== undefined) patch.gst_registered = body.gstRegistered;
  if (body.costsAcknowledged !== undefined) patch.costs_acknowledged = body.costsAcknowledged;
  if (body.defaultRateBps !== undefined) patch.default_rate_bps = body.defaultRateBps;
  if (body.defaultHsn !== undefined) patch.default_hsn = body.defaultHsn;
  if (body.booksStartDate !== undefined) patch.books_start_date = body.booksStartDate;
  const { error } = await supabase.from("accounting_settings").upsert(patch, { onConflict: "organization_id" });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save accounting settings.");

  if (body.gstRegistered && body.gstin) {
    const state = gstinStateCode(body.gstin);
    if (!state) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "GSTIN is invalid.");
    const gstin = body.gstin.toUpperCase();
    const current = await supabase
      .from("gst_registrations")
      .select("gstin")
      .eq("organization_id", organizationId)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (current.data?.gstin !== gstin) {
      await supabase.from("gst_registrations").upsert(
        { organization_id: organizationId, gstin, legal_name: body.legalName ?? null, state_code: state, effective_from: new Date().toISOString().slice(0, 10) },
        { onConflict: "organization_id,gstin,effective_from" }
      );
    }
  }

  return loadAccountingWorkspace(supabase, organizationId);
}

export async function saveProductCost(
  supabase: SupabaseClient,
  organizationId: string,
  input: { productId: string; unitCost: number }
) {
  const { error } = await supabase.from("product_costs").insert({
    organization_id: organizationId,
    product_id: input.productId,
    unit_cost: input.unitCost,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save the product cost.");
  return { saved: true };
}
