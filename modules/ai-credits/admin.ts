import { z } from "zod";
import type { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { AdminContext } from "@/lib/api/admin-context";
import { writeBillingAudit } from "@/modules/billing/audit";
import { loadAiCreditCatalog, mapAiCreditPackage, type AiCreditPackage } from "@/modules/ai-credits/catalog";
import { normalizeCreditLimits } from "@/modules/ai-credits/quote";
import type { createAdminClient } from "@/lib/supabase/admin";

const packageSchema = z.object({
  slug: z.string().min(2).optional(),
  name: z.string().min(1),
  credits: z.number().int().min(1).max(1_000_000),
  pricePaise: z.number().int().min(100).max(100_000_000),
  isRecommended: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
});

function ip(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function clearRecommended(
  supabase: ReturnType<typeof createAdminClient>,
  exceptId?: string
) {
  let query = supabase.from("ai_credit_packages").update({ is_recommended: false }).eq("is_recommended", true);
  if (exceptId) query = query.neq("id", exceptId);
  await query;
}

export async function handleAdminAiCredits(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext,
  slugs: string[],
  method: string
) {
  if (method === "PATCH" && slugs[1] === "settings") {
    const body = z
      .object({
        customMin: z.number().int().min(1).max(1_000_000),
        customMax: z.number().int().min(1).max(1_000_000),
      })
      .parse(await request.json());
    const custom = normalizeCreditLimits({ min: body.customMin, max: body.customMax });
    const { error } = await supabase
      .from("platform_settings")
      .update({
        ai_credit_custom_min: custom.min,
        ai_credit_custom_max: custom.max,
      })
      .eq("id", 1);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "ai_credits.settings_updated",
      targetType: "platform_settings",
      targetId: "1",
      ip: ip(request),
      metadata: custom,
    });
    return loadAiCreditCatalog({ includeInactive: true });
  }

  if (method === "GET" && slugs.length === 1) {
    const catalog = await loadAiCreditCatalog({ includeInactive: true });
    return {
      packages: catalog.packages,
      custom: catalog.custom,
    };
  }

  if (method === "POST" && slugs.length === 1) {
    const body = packageSchema.parse(await request.json());
    const slug = slugify(body.slug || body.name);
    if (body.isRecommended) await clearRecommended(supabase);
    const { data, error } = await supabase
      .from("ai_credit_packages")
      .insert({
        slug,
        name: body.name.trim(),
        credits: body.credits,
        price_paise: body.pricePaise,
        is_recommended: Boolean(body.isRecommended),
        display_order: body.displayOrder ?? 99,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "ai_credits.package_created",
      targetType: "ai_credit_package",
      targetId: data.id,
      ip: ip(request),
    });
    return mapAiCreditPackage(data as Record<string, unknown>);
  }

  const packageId = slugs[1];
  if (!packageId) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");

  if (method === "PUT") {
    const body = packageSchema.parse(await request.json());
    if (body.isRecommended) await clearRecommended(supabase, packageId);
    const { data, error } = await supabase
      .from("ai_credit_packages")
      .update({
        name: body.name.trim(),
        credits: body.credits,
        price_paise: body.pricePaise,
        is_recommended: Boolean(body.isRecommended),
        display_order: body.displayOrder ?? 0,
      })
      .eq("id", packageId)
      .select()
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "ai_credits.package_updated",
      targetType: "ai_credit_package",
      targetId: packageId,
      ip: ip(request),
    });
    return mapAiCreditPackage(data as Record<string, unknown>);
  }

  if (method === "PATCH" && slugs[2] === "status") {
    const body = z.object({ isActive: z.boolean() }).parse(await request.json());
    const { data, error } = await supabase
      .from("ai_credit_packages")
      .update(body.isActive ? { is_active: true } : { is_active: false, is_recommended: false })
      .eq("id", packageId)
      .select()
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    const pack = data as Record<string, unknown>;
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: body.isActive ? "ai_credits.package_activated" : "ai_credits.package_archived",
      targetType: "ai_credit_package",
      targetId: packageId,
      ip: ip(request),
    });
    return mapAiCreditPackage({ ...pack, is_recommended: body.isActive ? pack.is_recommended : false });
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}

export type { AiCreditPackage };
