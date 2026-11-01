import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { affiliateEnabled, isPublicReferralCode } from "@/modules/affiliates/policy";
import { readReferral, signReferral, visitorId, REFERRAL_COOKIE } from "@/modules/affiliates/cookie";
import { checked } from "@/modules/affiliates/service";
import { rateLimit } from "@/lib/security/rate-limit";
export async function GET(request: NextRequest) {
    const response = NextResponse.redirect(new URL("/", request.url));
    response.headers.set("Cache-Control", "no-store");
    if (!affiliateEnabled())
        return response;
    const code = request.nextUrl.searchParams.get("ref") || "";
    if (!isPublicReferralCode(code) || !rateLimit(`affiliate-click:${request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown"}`, 30, 60000).ok)
        return response;
    try {
        const db = createAdminClient();
        const link = checked(await db.from("affiliate_links").select("id,affiliate_id,affiliate_profiles!inner(status)").eq("code", code).eq("enabled", true).eq("affiliate_profiles.status", "APPROVED").maybeSingle());
        if (!link)
            return response;
        const existing = readReferral(request.cookies.get(REFERRAL_COOKIE)?.value);
        const visitor = existing?.visitor || visitorId();
        checked(await db.rpc("affiliate_record_click", { p_link: link.id, p_visitor: visitor }));
        if (!existing) {
            const settings = checked(await db.from("affiliate_settings").select("attribution_days").single());
            if (!settings)
                return response;
            const ttl = settings.attribution_days * 86400;
            response.cookies.set(REFERRAL_COOKIE, signReferral({ link: link.id, visitor, expires: Date.now() + ttl * 1000 }), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: ttl });
        }
    }
    catch { /* Tracking must never prevent landing-page access. */ }
    return response;
}
