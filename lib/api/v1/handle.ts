import type { NextRequest } from "next/server";
import { requireTenant } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { handleCommerceRoutes } from "@/lib/api/v1/commerce";
import { handleInboundWebhook, isInboundWebhookPath } from "@/lib/api/v1/inbound-webhooks";
import { handleIntegrationRoutes } from "@/lib/api/v1/integrations";
import { handleSessionRoutes } from "@/lib/api/v1/session";
import { handleWorkspaceRoutes } from "@/lib/api/v1/workspace";
import { permissionForTenantRoute } from "@/lib/api/v1-permissions";
import { rateLimit } from "@/lib/security/rate-limit";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseIndiaPostWebhookPath } from "@/modules/india-post/webhook-urls";
import { parseWatiWebhookPath } from "@/modules/wati/webhook-urls";

export async function handleV1(request: NextRequest, slugs: string[]) {
  const path = slugs.join("/");
  const method = request.method;
  const key = `${method} ${path}`;
  const indiaPostWebhook = parseIndiaPostWebhookPath(path);
  const watiWebhook = parseWatiWebhookPath(path);
  const limited = rateLimit(
    `${request.headers.get("x-forwarded-for") ?? "local"}:${path}`,
    indiaPostWebhook || watiWebhook ? 180 : 60
  );
  if (!limited.ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  }

  if (isInboundWebhookPath(path)) {
    const inbound = await handleInboundWebhook(request, path);
    if (inbound !== null) return inbound;
  }

  const supabase = await createServerSupabase();
  const session = await handleSessionRoutes(request, supabase, key);
  if (session !== null) return session;

  const ctx = await requireTenant(permissionForTenantRoute(method, path, slugs));
  return (
    (await handleWorkspaceRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handleCommerceRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handleIntegrationRoutes(request, supabase, ctx, key)) ??
    (() => {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
    })()
  );
}
