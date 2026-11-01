import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { affiliateEnabled } from "./policy";
import { readReferral, REFERRAL_COOKIE } from "./cookie";
function schemaMissing(error: unknown) {
    if (!error || typeof error !== "object") return false;
    const code = "code" in error ? String(error.code) : "";
    const message = "message" in error ? String(error.message) : "";
    return code === "PGRST205" || /could not find the table|schema cache/i.test(message);
}

export function checked<T>(result: {
    data: T;
    error: unknown;
}): T {
    if (result.error) {
        if (schemaMissing(result.error)) {
            throw new AppError(
                ERROR_CODES.AUTH_UNAVAILABLE,
                "Partner reporting tables are not installed on this database yet."
            );
        }
        throw new AppError(ERROR_CODES.CONFLICT, "The affiliate operation could not be completed. Please refresh and try again.");
    }
    return result.data;
}
export function requireAffiliates() {
    if (!affiliateEnabled())
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "The partner program is currently unavailable.");
}
export async function bindSignupReferral(userId: string) {
    if (!affiliateEnabled())
        return;
    const referral = readReferral((await cookies()).get(REFERRAL_COOKIE)?.value);
    if (!referral)
        return;
    checked(await createAdminClient().rpc("affiliate_bind_signup", {
        p_user: userId, p_link: referral.link, p_expires: new Date(referral.expires).toISOString(),
    }));
}
export async function partnerProfile(db: SupabaseClient, userId: string) {
    return checked(await db.from("affiliate_profiles").select("id,status,application,rejection_reason,created_at").eq("user_id", userId).maybeSingle());
}
export async function partnerSummary(db: SupabaseClient, affiliateId: string, from: string, to: string) {
    return checked(await db.rpc("affiliate_summary", { p_affiliate: affiliateId, p_from: from, p_to: to }));
}
