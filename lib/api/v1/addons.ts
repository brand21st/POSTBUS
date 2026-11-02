import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { AI_ACCOUNTANT_SLUG } from "@/modules/addons/constants";
import { getAddonCatalogRow, listAddonCatalog, mapCatalog } from "@/modules/addons/catalog";
import { cancelAddonSubscription, startAddonCheckout } from "@/modules/addons/checkout";
import { getAddonEntitlement, listOrganizationAddonEntitlements } from "@/modules/addons/entitlements";

function writeClient() {
  if (!hasAdminClient()) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Billing writes require the service role.");
  }
  return createAdminClient();
}

function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function handleAddonRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  key: string
) {
  if (key === "GET addons") {
    const catalog = await listAddonCatalog(writeClient(), { includeInactive: true });
    const entitlements = await listOrganizationAddonEntitlements(writeClient(), ctx.organizationId);
    const bySlug = new Map(entitlements.map((row) => [row.addon_slug, row]));
    return {
      items: catalog
        .filter((row) => row.is_active || bySlug.has(row.slug))
        .map((row) => {
          const entitlement = bySlug.get(row.slug);
          return {
            ...mapCatalog(row),
            entitlement: entitlement
              ? {
                  status: entitlement.status,
                  accessMode: entitlement.access_mode,
                  currentPeriodEnd: entitlement.current_period_end,
                }
              : { status: "NOT_INSTALLED", accessMode: "NONE", currentPeriodEnd: null },
          };
        }),
    };
  }

  if (key === "GET addons/ai-accountant") {
    const catalog = await getAddonCatalogRow(writeClient(), AI_ACCOUNTANT_SLUG);
    const entitlement = await getAddonEntitlement(writeClient(), ctx.organizationId, AI_ACCOUNTANT_SLUG);
    if (!catalog) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "AI Accountant is not configured.");
    return {
      addon: mapCatalog(catalog),
      entitlement: entitlement
        ? {
            status: entitlement.status,
            accessMode: entitlement.access_mode,
            currentPeriodStart: entitlement.current_period_start,
            currentPeriodEnd: entitlement.current_period_end,
          }
        : { status: "NOT_INSTALLED", accessMode: "NONE" },
    };
  }

  if (key === "POST addons/ai-accountant/checkout") {
    const body = z.object({ billingCycle: z.enum(["monthly", "yearly"]) }).parse(await request.json());
    return startAddonCheckout(writeClient(), {
      organizationId: ctx.organizationId,
      organizationName: ctx.organizationName,
      email: ctx.email,
      userId: ctx.userId,
      billingCycle: body.billingCycle,
      ip: clientIp(request),
    });
  }

  if (key === "POST addons/ai-accountant/cancel") {
    return cancelAddonSubscription(writeClient(), {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      ip: clientIp(request),
    });
  }

  return null;
}
