import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  createShipmentPreset,
  createShipmentPresetSchema,
  deleteShipmentPreset,
  listShipmentPresets,
  touchShipmentPreset,
} from "@/modules/shipments/presets";

export async function handleShipmentPresetRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  method: string,
  slugs: string[]
) {
  if (slugs[0] !== "shipment-presets") return null;

  if (slugs.length === 1 && method === "GET") {
    return listShipmentPresets(supabase, ctx.userId, ctx.organizationId);
  }

  if (slugs.length === 1 && method === "POST") {
    const body = createShipmentPresetSchema.parse(await request.json().catch(() => ({})));
    return createShipmentPreset(supabase, ctx.userId, ctx.organizationId, body);
  }

  if (slugs.length === 2 && method === "DELETE") {
    return deleteShipmentPreset(supabase, ctx.userId, ctx.organizationId, slugs[1]);
  }

  if (slugs.length === 3 && slugs[2] === "use" && method === "POST") {
    return touchShipmentPreset(supabase, ctx.userId, ctx.organizationId, slugs[1]);
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}
