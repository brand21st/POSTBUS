import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { getTableLayout, saveTableLayout, saveTableLayoutSchema } from "@/modules/ui/table-layouts";

export async function handleUiRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  method: string,
  slugs: string[]
) {
  if (slugs[0] !== "ui" || slugs[1] !== "table-layouts" || !slugs[2] || slugs.length !== 3) {
    return null;
  }

  const tableKey = slugs[2];

  if (method === "GET") {
    return getTableLayout(supabase, ctx.userId, ctx.organizationId, tableKey);
  }

  if (method === "PUT") {
    const body = saveTableLayoutSchema.parse(await request.json().catch(() => ({})));
    return saveTableLayout(supabase, ctx.userId, ctx.organizationId, tableKey, body.columnWidths);
  }

  return null;
}
