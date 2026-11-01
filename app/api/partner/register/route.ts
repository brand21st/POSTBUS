import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { authCallbackUrl } from "@/lib/auth/urls";
import { ok, fail } from "@/lib/api/response";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { checked, requireAffiliates } from "@/modules/affiliates/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { originsMatch } from "@/lib/security/origin";
function assertSameOrigin(request: NextRequest) {
    if (!originsMatch(request.headers.get("origin"), request.nextUrl.origin))
        throw new AppError(ERROR_CODES.FORBIDDEN, "Invalid origin.");
}
export async function POST(request: NextRequest) {
    try {
        requireAffiliates();
        assertSameOrigin(request);
        if (!rateLimit(`partner-register:${request.headers.get("x-forwarded-for")}`, 5, 60000).ok)
            throw new AppError(ERROR_CODES.RATE_LIMITED, "Try again shortly.");
        const settings = checked(await createAdminClient().from("affiliate_settings").select("registration_open").single());
        if (!settings?.registration_open)
            throw new AppError(ERROR_CODES.FORBIDDEN, "Partner registration is closed.");
        const { email, password, name } = z.object({ email: z.email(), password: z.string().min(10).max(128), name: z.string().trim().min(2).max(120) }).strict().parse(await request.json());
        const db = await createServerSupabase();
        const { error } = await db.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: authCallbackUrl("/partner/dashboard") } });
        if (error)
            throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not register. Try signing in if you already have an account.");
        return ok({ message: "Check your email to confirm your account, then open the partner dashboard." });
    }
    catch (error) {
        return fail(error);
    }
}
// Explicit partner login avoids merchant session bootstrap and OTP workspace creation.
export async function PUT(request: NextRequest) {
    try {
        requireAffiliates();
        assertSameOrigin(request);
        if (!rateLimit(`partner-login:${request.headers.get("x-forwarded-for")}`, 8, 60000).ok)
            throw new AppError(ERROR_CODES.RATE_LIMITED, "Try again shortly.");
        const input = z.object({ email: z.email(), password: z.string().min(1).max(128) }).strict().parse(await request.json());
        const { error } = await (await createServerSupabase()).auth.signInWithPassword(input);
        if (error)
            return NextResponse.json({ success: false, error: { message: "Unable to sign in." } }, { status: 401 });
        return ok({ signedIn: true });
    }
    catch (error) {
        return fail(error);
    }
}
