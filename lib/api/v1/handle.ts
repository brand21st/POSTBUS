import type { NextRequest } from "next/server";
import { requireTenant } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { dispatchTenantRoutes } from "@/lib/api/v1/dispatch";
import { handleInboundWebhook, isInboundWebhookPath } from "@/lib/api/v1/inbound-webhooks";
import { handlePrintAgentRoutes, isPrintAgentApiPath } from "@/lib/api/v1/print";
import { handlePrintDevicePublicRoutes, isPrintDevicePublicPath } from "@/lib/api/v1/print-devices";
import { handleSessionRoutes } from "@/lib/api/v1/session";
import { handleBillingRoutes } from "@/lib/api/v1/billing";
import { permissionForTenantRoute } from "@/lib/api/v1-permissions";
import { rateLimit } from "@/lib/security/rate-limit";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseIndiaPostWebhookPath } from "@/modules/india-post/webhook-urls";
import { parseWatiWebhookPath } from "@/modules/wati/webhook-urls";
import { parseWooWebhookPath } from "@/modules/woocommerce/webhooks";

export async function handleV1(request: NextRequest, slugs: string[]) {
  const path = slugs.join("/");
  const method = request.method;
  const key = `${method} ${path}`;
  const indiaPostWebhook = parseIndiaPostWebhookPath(path);
  const watiWebhook = parseWatiWebhookPath(path);
  const wooWebhook = parseWooWebhookPath(path);
  const printAgentPath = isPrintAgentApiPath(path);
  const printDevicePath = isPrintDevicePublicPath(path);
  const limited = rateLimit(
    `${request.headers.get("x-forwarded-for") ?? "local"}:${path}`,
    indiaPostWebhook || watiWebhook || wooWebhook || printAgentPath || printDevicePath ? 180 : 60
  );
  if (!limited.ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  }

  if (isInboundWebhookPath(path)) {
    const inbound = await handleInboundWebhook(request, path);
    if (inbound !== null) return inbound;
  }

  if (path === "vachat/mcp") {
    const { handleVachatMcpRequest } = await import("@/modules/vachat/mcp-http");
    return handleVachatMcpRequest(request);
  }

  if (isPrintAgentApiPath(path)) {
    const printAgent = await handlePrintAgentRoutes(request, path, slugs);
    if (printAgent !== null) return printAgent;
  }

  if (isPrintDevicePublicPath(path)) {
    return handlePrintDevicePublicRoutes(request, path);
  }

  const supabase = await createServerSupabase();
  if (key === "GET billing/plans") {
    const publicPlans = await handleBillingRoutes(request, supabase, null, key);
    if (publicPlans !== null) return publicPlans;
  }

  const session = await handleSessionRoutes(request, supabase, key);
  if (session !== null) return session;

  const ctx = await requireTenant(permissionForTenantRoute(method, path, slugs));
  return dispatchTenantRoutes(request, supabase, ctx, { key, path, method, slugs });
}

