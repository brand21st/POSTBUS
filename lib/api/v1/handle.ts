import type { NextRequest } from "next/server";
import { requireTenant } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { handleCommerceRoutes } from "@/lib/api/v1/commerce";
import { handleInboundWebhook, isInboundWebhookPath } from "@/lib/api/v1/inbound-webhooks";
import { handleIntegrationRoutes } from "@/lib/api/v1/integrations";
import { handleInvoiceRoutes } from "@/lib/api/v1/invoices";
import { handleLabelTemplateRoutes } from "@/lib/api/v1/label-template";
import { handlePrintAgentRoutes, handlePrintStationRoutes, isPrintAgentApiPath } from "@/lib/api/v1/print";
import { handleSessionRoutes } from "@/lib/api/v1/session";
import { handleBillingRoutes } from "@/lib/api/v1/billing";
import { handleWorkspaceRoutes } from "@/lib/api/v1/workspace";
import { permissionForTenantRoute } from "@/lib/api/v1-permissions";
import { rateLimit } from "@/lib/security/rate-limit";
import { createServerSupabase } from "@/lib/supabase/server";
import { assertPlanFeature, lockedFeatureForApi } from "@/modules/billing/entitlements";
import { parseIndiaPostWebhookPath } from "@/modules/india-post/webhook-urls";
import { parseWatiWebhookPath } from "@/modules/wati/webhook-urls";

export async function handleV1(request: NextRequest, slugs: string[]) {
  const path = slugs.join("/");
  const method = request.method;
  const key = `${method} ${path}`;
  const indiaPostWebhook = parseIndiaPostWebhookPath(path);
  const watiWebhook = parseWatiWebhookPath(path);
  const printAgentPath = isPrintAgentApiPath(path);
  const limited = rateLimit(
    `${request.headers.get("x-forwarded-for") ?? "local"}:${path}`,
    indiaPostWebhook || watiWebhook || printAgentPath ? 180 : 60
  );
  if (!limited.ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  }

  if (isInboundWebhookPath(path)) {
    const inbound = await handleInboundWebhook(request, path);
    if (inbound !== null) return inbound;
  }

  if (isPrintAgentApiPath(path)) {
    const printAgent = await handlePrintAgentRoutes(request, path, slugs);
    if (printAgent !== null) return printAgent;
  }

  const supabase = await createServerSupabase();
  if (key === "GET billing/plans") {
    const publicPlans = await handleBillingRoutes(request, supabase, null, key);
    if (publicPlans !== null) return publicPlans;
  }

  const session = await handleSessionRoutes(request, supabase, key);
  if (session !== null) return session;

  const ctx = await requireTenant(permissionForTenantRoute(method, path, slugs));
  const planFeature = lockedFeatureForApi(method, path, slugs);
  if (planFeature) await assertPlanFeature(supabase, ctx.organizationId, planFeature);
  return (
    (await handleBillingRoutes(request, supabase, ctx, key)) ??
    (await handleWorkspaceRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handlePrintStationRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handleLabelTemplateRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handleInvoiceRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handleCommerceRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handleIntegrationRoutes(request, supabase, ctx, key)) ??
    (() => {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
    })()
  );
}
