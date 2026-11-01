import { z } from "zod";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { assertAdminActionPin } from "@/lib/admin/action-pin";
import { billingTaxAutomationEnabled, gstInclusiveLabelEnabled } from "@/modules/billing/inclusive-tax";

const proposeSchema = z.object({
    pin: z.string().min(1),
    treatment: z.enum(["SINGLE_RATE_INCLUSIVE", "ZERO_RATED"]),
    rateBasisPoints: z.number().int().min(0).max(9999).nullable(),
    placeOfSupply: z.enum(["INTRA", "INTER"]).nullable(),
    effectiveAt: z.string().min(4),
    reason: z.string().trim().min(3).max(500),
}).strict();

const idSchema = z.object({ pin: z.string().min(1), policyId: z.string().uuid() }).strict();
const applySchema = z.object({ pin: z.string().min(1), paymentId: z.string().uuid() }).strict();

function missingRelation(error: { code?: string; message?: string } | null) {
    return error?.code === "42P01" || error?.code === "PGRST205" || /subscription_tax_policies|subscription_tax_breakdowns/i.test(error?.message ?? "");
}

export async function handleTaxPolicyAdmin(supabase: SupabaseClient, request: NextRequest, actorId: string, slugs: string[], method: string) {
    if (method === "GET" && slugs.length === 0)
        return loadTaxPolicies(supabase);
    if (method === "POST" && slugs[0] === "propose")
        return proposeTaxPolicy(supabase, request, actorId);
    if (method === "POST" && slugs[0] === "approve")
        return changeTaxPolicy(supabase, request, actorId, "subscription_approve_tax_policy");
    if (method === "POST" && slugs[0] === "retire")
        return changeTaxPolicy(supabase, request, actorId, "subscription_retire_tax_policy");
    if (method === "POST" && slugs[0] === "apply")
        return applyApprovedTax(supabase, request);
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}

async function loadTaxPolicies(supabase: SupabaseClient) {
    const policies = await supabase.from("subscription_tax_policies").select("id,version,status,prices_include_tax,treatment,rate_basis_points,place_of_supply,effective_at,approved_at,retired_at,reason,created_at").order("version", { ascending: false }).limit(50);
    const breakdowns = await supabase.from("subscription_tax_breakdowns").select("id,payment_id,organization_id,subscription_id,policy_version,gross_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_tax_paise,source,created_at").order("created_at", { ascending: false }).limit(25);
    if (missingRelation(policies.error) || missingRelation(breakdowns.error)) {
        return { automationEnabled: billingTaxAutomationEnabled(), inclusiveLabelEnabled: gstInclusiveLabelEnabled(), migrationRequired: true, policies: [], breakdowns: [] };
    }
    if (policies.error)
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, policies.error.message);
    if (breakdowns.error)
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, breakdowns.error.message);
    return { automationEnabled: billingTaxAutomationEnabled(), inclusiveLabelEnabled: gstInclusiveLabelEnabled(), migrationRequired: false, policies: policies.data ?? [], breakdowns: breakdowns.data ?? [] };
}

async function proposeTaxPolicy(supabase: SupabaseClient, request: NextRequest, actorId: string) {
    const body = proposeSchema.parse(await request.json());
    assertAdminActionPin(body.pin);
    const { data, error } = await supabase.rpc("subscription_propose_tax_policy", {
        p_actor: actorId,
        p_data: { treatment: body.treatment, rateBasisPoints: body.rateBasisPoints, placeOfSupply: body.placeOfSupply, effectiveAt: body.effectiveAt, reason: body.reason, pricesIncludeTax: true },
    });
    if (error)
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return { id: data, status: "DRAFT" };
}

async function changeTaxPolicy(supabase: SupabaseClient, request: NextRequest, actorId: string, fn: "subscription_approve_tax_policy" | "subscription_retire_tax_policy") {
    const body = idSchema.parse(await request.json());
    assertAdminActionPin(body.pin);
    const { data, error } = await supabase.rpc(fn, { p_actor: actorId, p_policy: body.policyId });
    if (error)
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return { status: data };
}

async function applyApprovedTax(supabase: SupabaseClient, request: NextRequest) {
    const body = applySchema.parse(await request.json());
    assertAdminActionPin(body.pin);
    if (!billingTaxAutomationEnabled())
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Subscription tax automation is disabled.");
    const { data, error } = await supabase.rpc("subscription_apply_approved_tax", { p_payment: body.paymentId });
    if (error)
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return { status: data };
}
