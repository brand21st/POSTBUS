import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { assertAdminActionPin } from "@/lib/admin/action-pin";
import { writeBillingAudit } from "@/modules/billing/audit";
import { ADDON_PAYMENT_PURPOSE } from "@/modules/addons/constants";
import { mapCatalog } from "@/modules/addons/catalog";
import { upsertAddonEntitlement } from "@/modules/addons/entitlements";
import type { AdminContext } from "@/lib/api/admin-context";

const catalogPatch = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(400).optional(),
  category: z.string().trim().max(80).optional(),
  monthlyPricePaise: z.number().int().min(0).optional(),
  yearlyPricePaise: z.number().int().min(0).optional(),
  promoMonthlyPricePaise: z.number().int().min(0).nullable().optional(),
  promoYearlyPricePaise: z.number().int().min(0).nullable().optional(),
  promoStartsAt: z.string().datetime().nullable().optional(),
  promoEndsAt: z.string().datetime().nullable().optional(),
  includedAssistantQuestions: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});

function ip(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function handleAdminAddons(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: AdminContext,
  slugs: string[],
  method: string
) {
  const rest = slugs.slice(1);
  const key = `${method} ${rest.join("/")}`;

  if (key === "GET " || key === "GET catalog") {
    const { data } = await supabase.from("addon_catalog").select("*").order("display_order");
    return { addons: (data ?? []).map((row) => mapCatalog(row as never)) };
  }

  if (method === "PATCH" && rest[0] && rest.length === 1) {
    const body = catalogPatch.parse(await request.json());
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.category !== undefined) patch.category = body.category;
    if (body.monthlyPricePaise !== undefined) patch.monthly_price_paise = body.monthlyPricePaise;
    if (body.yearlyPricePaise !== undefined) patch.yearly_price_paise = body.yearlyPricePaise;
    if (body.promoMonthlyPricePaise !== undefined) patch.promo_monthly_price_paise = body.promoMonthlyPricePaise;
    if (body.promoYearlyPricePaise !== undefined) patch.promo_yearly_price_paise = body.promoYearlyPricePaise;
    if (body.promoStartsAt !== undefined) patch.promo_starts_at = body.promoStartsAt;
    if (body.promoEndsAt !== undefined) patch.promo_ends_at = body.promoEndsAt;
    if (body.includedAssistantQuestions !== undefined) {
      patch.included_assistant_questions = body.includedAssistantQuestions;
    }
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    const { data, error } = await supabase
      .from("addon_catalog")
      .update(patch)
      .eq("id", rest[0])
      .select("*")
      .single();
    if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not save add-on.");
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "addon.catalog_updated",
      targetType: "addon_catalog",
      targetId: rest[0],
      ip: ip(request),
      metadata: body,
    });
    return mapCatalog(data as never);
  }

  if (key === "GET subscriptions") {
    const { data } = await supabase
      .from("organization_addon_subscriptions")
      .select("*, organizations(name)")
      .order("updated_at", { ascending: false })
      .limit(200);
    return { subscriptions: data ?? [] };
  }

  if (key === "GET payments") {
    const { data } = await supabase
      .from("payments")
      .select("*")
      .eq("payment_purpose", ADDON_PAYMENT_PURPOSE)
      .order("created_at", { ascending: false })
      .limit(200);
    return { payments: data ?? [] };
  }

  if (key === "GET revenue") {
    const { data } = await supabase
      .from("payments")
      .select("amount_paise, status")
      .eq("payment_purpose", ADDON_PAYMENT_PURPOSE);
    const captured = (data ?? []).filter((row) => row.status === "CAPTURED");
    const failed = (data ?? []).filter((row) => row.status === "FAILED");
    return {
      capturedPaise: captured.reduce((sum, row) => sum + Number(row.amount_paise ?? 0), 0),
      capturedCount: captured.length,
      failedCount: failed.length,
    };
  }

  if (method === "POST" && rest[0] === "grant") {
    const body = z
      .object({
        organizationId: z.string().uuid(),
        slug: z.string().min(1),
        pin: z.string(),
        months: z.number().int().min(1).max(24).default(1),
      })
      .parse(await request.json());
    assertAdminActionPin(body.pin);
    const end = new Date();
    end.setUTCMonth(end.getUTCMonth() + body.months);
    const start = new Date().toISOString();
    await upsertAddonEntitlement(supabase, {
      organizationId: body.organizationId,
      slug: body.slug,
      status: "ACTIVE",
      currentPeriodStart: start,
      currentPeriodEnd: end.toISOString(),
    });
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "addon.granted",
      targetType: "organization",
      targetId: body.organizationId,
      organizationId: body.organizationId,
      ip: ip(request),
      metadata: { slug: body.slug, months: body.months },
    });
    return { granted: true };
  }

  if (method === "POST" && rest[0] === "revoke") {
    const body = z
      .object({ organizationId: z.string().uuid(), slug: z.string().min(1), pin: z.string() })
      .parse(await request.json());
    assertAdminActionPin(body.pin);
    await upsertAddonEntitlement(supabase, {
      organizationId: body.organizationId,
      slug: body.slug,
      status: "SUSPENDED",
    });
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "addon.revoked",
      targetType: "organization",
      targetId: body.organizationId,
      organizationId: body.organizationId,
      ip: ip(request),
      metadata: { slug: body.slug },
    });
    return { revoked: true };
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}
