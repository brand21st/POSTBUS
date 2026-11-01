import { NextResponse, type NextRequest } from "next/server";
import bwipjs from "bwip-js";
import { getRequestAuthUser } from "@/lib/supabase/request-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAffiliates, partnerProfile, checked } from "@/modules/affiliates/service";
import { fail } from "@/lib/api/response";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
export async function GET(request: NextRequest) {
    try {
        requireAffiliates();
        const { user } = await getRequestAuthUser();
        if (!user)
            throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Sign in.");
        const db = createAdminClient();
        const p = await partnerProfile(db, user.id);
        const link = checked(await db.from("affiliate_links").select("code").eq("affiliate_id", p?.id || "").eq("code", request.nextUrl.searchParams.get("code") || "").eq("enabled", true).maybeSingle());
        if (!link)
            throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Link not found.");
        const buffer = await bwipjs.toBuffer({ bcid: "qrcode", text: `${request.nextUrl.origin}/?ref=${link.code}`, scale: 4 });
        return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        return fail(error);
    }
}
