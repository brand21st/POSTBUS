import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  listPackagingHistory,
  rejectPackagingHistoryForOrder,
  retirePackagingHistory,
  verifyPackagingHistory,
} from "@/modules/autopack/history";
import { getOrderAutoPackRecommendation } from "@/modules/autopack/service";

const rejectSchema = z.object({ evidenceId: z.string().uuid() });
const uuid = z.string().uuid();

/**
 * GET  autopack/orders/:orderId              what AutoPack would choose (read-only)
 * POST autopack/orders/:orderId/reject        { evidenceId } never suggest that past box for this order
 * GET  autopack/history                       live past boxes for the workspace
 * POST autopack/history/:id/verify            merchant marks a past box as measured
 * POST autopack/history/:id/retire            stop using a past box
 * Accepting a suggestion goes through PATCH orders/:id/dimensions with autopackEvidenceId.
 */
export async function handleAutoPackRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  method: string,
  slugs: string[]
) {
  if (slugs[0] !== "autopack") return null;

  if (slugs[1] === "orders" && slugs[2] && slugs.length === 3 && method === "GET") {
    return getOrderAutoPackRecommendation(supabase, ctx, uuid.parse(slugs[2]));
  }

  if (slugs[1] === "orders" && slugs[2] && slugs[3] === "reject" && slugs.length === 4 && method === "POST") {
    const body = rejectSchema.parse(await request.json().catch(() => ({})));
    return rejectPackagingHistoryForOrder(supabase, ctx, body.evidenceId, uuid.parse(slugs[2]));
  }

  if (slugs[1] === "history" && slugs.length === 2 && method === "GET") {
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    return listPackagingHistory(supabase, ctx.organizationId, { limit: Number.isFinite(limit) ? limit : 50 });
  }

  if (slugs[1] === "history" && slugs[2] && slugs[3] === "verify" && slugs.length === 4 && method === "POST") {
    return verifyPackagingHistory(supabase, ctx, uuid.parse(slugs[2]));
  }

  if (slugs[1] === "history" && slugs[2] && slugs[3] === "retire" && slugs.length === 4 && method === "POST") {
    return retirePackagingHistory(supabase, ctx, uuid.parse(slugs[2]));
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}
