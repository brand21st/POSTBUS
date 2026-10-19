import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { handleAssistantRoutes } from "@/lib/api/v1/ai-accountant/assistant";
import { handleBooksRoutes } from "@/lib/api/v1/ai-accountant/books";
import { handleCodRoutes } from "@/lib/api/v1/ai-accountant/cod";
import { handleExpenseRoutes } from "@/lib/api/v1/ai-accountant/expenses";
import { handleExportRoutes } from "@/lib/api/v1/ai-accountant/exports";
import { handleGstRoutes } from "@/lib/api/v1/ai-accountant/gst";
import type { AccountantRoute } from "@/lib/api/v1/ai-accountant/shared";
import { assertAddonEntitlement } from "@/modules/addons/entitlements";

/** Reads that do not change books even though they use POST. */
const READ_POSTS = new Set(["POST ai-accountant/assistant", "POST ai-accountant/cod/preview"]);

/**
 * AI Accountant tenant routes. dispatchTenantRoutes has already checked
 * accounting.read/write; here we gate on the paid add-on (NONE → 404,
 * READ_ONLY blocks writes) and run services with the service role, always
 * scoped by ctx.organizationId.
 */
export async function handleAiAccountantRoutes(
  request: NextRequest,
  _supabase: SupabaseClient,
  ctx: TenantContext,
  key: string,
  method: string,
  slugs: string[]
) {
  if (slugs[0] !== "ai-accountant") return null;
  if (!hasAdminClient()) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "AI Accountant requires the service role.");
  }
  const admin = createAdminClient();
  const write = method !== "GET" && !READ_POSTS.has(key);
  const accessMode = await assertAddonEntitlement(admin, ctx.organizationId, { write });
  const route: AccountantRoute = { request, admin, ctx, key, method, slugs, accessMode };
  const result =
    (await handleBooksRoutes(route)) ??
    (await handleExpenseRoutes(route)) ??
    (await handleGstRoutes(route)) ??
    (await handleCodRoutes(route)) ??
    (await handleExportRoutes(route)) ??
    (await handleAssistantRoutes(route));
  if (result === null || result === undefined) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
  return result;
}
