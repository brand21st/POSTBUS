import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { handlePartnerApi } from "@/modules/affiliates/api";
export const dynamic = "force-dynamic";
async function handle(request: NextRequest, context: {
    params: Promise<{
        slugs: string[];
    }>;
}) {
    try {
        return ok(await handlePartnerApi(request, (await context.params).slugs.join("/")));
    }
    catch (error) {
        return fail(error);
    }
}
export { handle as GET, handle as POST, handle as PATCH };
