import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { handleAddonRoutes } from "@/lib/api/v1/addons";
import { handleAiAccountantRoutes } from "@/lib/api/v1/ai-accountant";
import { handleAutoPackRoutes } from "@/lib/api/v1/autopack";
import { handleBillingRoutes } from "@/lib/api/v1/billing";
import { handleBookingQueueRoutes } from "@/lib/api/v1/booking-queue";
import { handleCommerceRoutes } from "@/lib/api/v1/commerce";
import { handleIntegrationRoutes } from "@/lib/api/v1/integrations";
import { handleInventoryRoutes } from "@/lib/api/v1/inventory";
import { handleInvoiceRoutes } from "@/lib/api/v1/invoices";
import { handleLabelTemplateRoutes } from "@/lib/api/v1/label-template";
import { handleManifestRoutes } from "@/lib/api/v1/manifests";
import { handleOrderDefaultRoutes } from "@/lib/api/v1/order-defaults";
import { handlePrintStationRoutes } from "@/lib/api/v1/print";
import { handlePrintDeviceTenantRoutes } from "@/lib/api/v1/print-devices";
import { handleShipmentPresetRoutes } from "@/lib/api/v1/shipment-presets";
import { handleSupportRoutes } from "@/lib/api/v1/support";
import { handleTariffRoutes } from "@/lib/api/v1/tariff";
import { handleMerchantTutorials } from "@/lib/api/v1/tutorials";
import { handleUiRoutes } from "@/lib/api/v1/ui";
import { handleWorkspaceRoutes } from "@/lib/api/v1/workspace";
import { permissionForTenantRoute } from "@/lib/api/v1-permissions";
import { hasPermission } from "@/lib/permissions/rbac";
import { assertPlanFeature, lockedFeatureForApi } from "@/modules/billing/entitlements";

export type TenantRoute = { key: string; path: string; method: string; slugs: string[] };

/**
 * Tenant-scoped v1 routes, shared by the cookie dashboard (handleV1) and the Shopify embedded app.
 * Callers resolve ctx and pass a Supabase client that runs as a member of ctx.organizationId (RLS applies).
 * Permission and plan checks live here so no caller can skip them.
 */
export async function dispatchTenantRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  route: TenantRoute
) {
  const { key, path, method, slugs } = route;
  const permission = permissionForTenantRoute(method, path, slugs);
  if (permission && !hasPermission(ctx.role, permission)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "You do not have permission to perform this action.");
  }
  const planFeature = lockedFeatureForApi(method, path, slugs);
  if (planFeature) await assertPlanFeature(supabase, ctx.organizationId, planFeature);
  return (
    (await handleTariffRoutes(request, supabase, ctx, path)) ??
    (await handleBillingRoutes(request, supabase, ctx, key)) ??
    (await handleAddonRoutes(request, supabase, ctx, key)) ??
    (await handleAiAccountantRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handleWorkspaceRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handleSupportRoutes(request, supabase, ctx, method, slugs)) ??
    (await handleUiRoutes(request, supabase, ctx, method, slugs)) ??
    (await handleShipmentPresetRoutes(request, supabase, ctx, method, slugs)) ??
    (await handleAutoPackRoutes(request, supabase, ctx, method, slugs)) ??
    (await handleBookingQueueRoutes(request, supabase, ctx, method, slugs)) ??
    (await handleOrderDefaultRoutes(request, supabase, ctx, method, slugs)) ??
    (await handlePrintStationRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handlePrintDeviceTenantRoutes(request, supabase, ctx, method, slugs)) ??
    (await handleLabelTemplateRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handleInvoiceRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handleInventoryRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handleManifestRoutes(request, supabase, ctx, method, slugs)) ??
    (await handleCommerceRoutes(request, supabase, ctx, key, method, slugs)) ??
    (await handleIntegrationRoutes(request, supabase, ctx, key)) ??
    (await handleMerchantTutorials(request, supabase, slugs, method)) ??
    (() => {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
    })()
  );
}
