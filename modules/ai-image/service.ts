import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { ZERO_AI_CREDITS_MESSAGE, AI_CREDIT_REASON_IMAGE_STUDIO } from "@/modules/ai-credits/constants";
import {
  getAiCreditsRemaining,
  releaseAiCreditReservation,
  reserveAiCredits,
} from "@/modules/ai-credits/service";
import { getImageStudioConfig } from "@/modules/ai-image/config";
import {
  COVER_ENHANCE_ACTIONS,
  COVER_FESTIVALS,
  COVER_PRESETS,
  COVER_TYPES,
  identityRiskForEnhance,
} from "@/modules/ai-image/cover-presets";
import {
  AI_IMAGE_ASPECTS,
  AI_IMAGE_PRESETS,
  AI_IMAGE_ROLES,
  FESTIVAL_THEMES,
  suggestedPresetForCategory,
} from "@/modules/ai-image/presets";
import { offerDiscountPercent, type OfferOverlayInput } from "@/modules/ai-image/offer";
import {
  ALLOWED_PRODUCT_IMAGE_TYPES,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES,
  PRODUCT_IMAGE_BUCKET,
  productImagePublicUrl,
} from "@/modules/products/images";
import { createBackgroundJob } from "@/modules/jobs/service";
import { claimedJobFromRow, runQueuedJobsNow } from "@/lib/jobs/drain";

export const createSessionSchema = z.object({
  productId: z.string().uuid().optional().nullable(),
});

export const createJobSchema = z.object({
  sessionId: z.string().uuid(),
  sourceAssetId: z.string().uuid(),
  preset: z.enum(AI_IMAGE_PRESETS),
  festival: z.enum(FESTIVAL_THEMES).optional().nullable(),
  aspect: z.enum(AI_IMAGE_ASPECTS).default("1:1"),
  role: z.enum(AI_IMAGE_ROLES).default("main"),
  customPrompt: z.string().trim().max(500).optional().nullable(),
  categoryHint: z.string().trim().max(80).optional().nullable(),
  variationCount: z.number().int().min(1).max(3).default(1),
  idempotencyKey: z.string().uuid(),
  offer: z
    .object({
      productName: z.string().trim().min(1).max(80),
      pricePaise: z.number().int().min(0).max(100_000_000),
      compareAtPaise: z.number().int().min(0).max(100_000_000).nullable().optional(),
      headline: z.string().trim().max(40).optional().nullable(),
      cta: z.string().trim().max(24).optional().nullable(),
      expiry: z.string().trim().max(40).optional().nullable(),
    })
    .optional(),
});

export const createCoverJobSchema = z.object({
  sessionId: z.string().uuid(),
  sourceAssetId: z.string().uuid(),
  coverId: z.string().uuid().optional().nullable(),
  preset: z.enum(COVER_PRESETS),
  festival: z.enum(COVER_FESTIVALS).optional().nullable(),
  enhance: z.enum(COVER_ENHANCE_ACTIONS).optional().nullable(),
  coverType: z.enum(COVER_TYPES).optional(),
  customPrompt: z.string().trim().max(500).optional().nullable(),
  categoryHint: z.string().trim().max(80).optional().nullable(),
  variants: z.array(z.enum(["desktop", "mobile"])).min(1).max(2).default(["desktop"]),
  variationCount: z.number().int().min(1).max(3).default(1),
  idempotencyKey: z.string().uuid(),
});

export const selectSchema = z.object({
  assetIds: z.array(z.string().uuid()).max(MAX_PRODUCT_IMAGES),
});

export const attachSchema = z.object({
  sessionId: z.string().uuid(),
  productId: z.string().uuid(),
  assetIds: z.array(z.string().uuid()).min(1).max(MAX_PRODUCT_IMAGES),
});

function assertImageFile(file: File) {
  if (!ALLOWED_PRODUCT_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_PRODUCT_IMAGE_TYPES)[number])) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Upload a PNG, JPEG, or WebP photo.");
  }
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Product photos must be 5 MB or smaller.");
  }
}

async function requireSession(
  supabase: SupabaseClient,
  ctx: TenantContext,
  sessionId: string
) {
  const { data, error } = await supabase
    .from("ai_image_sessions")
    .select("id, organization_id, product_id, expires_at")
    .eq("id", sessionId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Image studio session not found.");
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This studio session expired. Open Enhance with AI again.");
  }
  return data;
}

export async function quoteImageStudio() {
  const config = await getImageStudioConfig();
  return {
    enabled: config.enabled,
    creditCost: config.creditCost,
    coverCreditCost: config.coverCreditCost,
    maxVariations: config.maxVariations,
    suggestedPreset: suggestedPresetForCategory(null),
    warning:
      "AI can change lighting and background. Check logos, labels, and colour before you save a generated photo as the product image.",
  };
}

export async function createImageStudioSession(
  supabase: SupabaseClient,
  ctx: TenantContext,
  productId?: string | null
) {
  const config = await getImageStudioConfig();
  if (!config.enabled) {
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      "AI Image Studio is off. Ask PostBus support to enable it in Admin settings."
    );
  }
  const { data, error } = await supabase
    .from("ai_image_sessions")
    .insert({
      organization_id: ctx.organizationId,
      created_by: ctx.userId,
      product_id: productId || null,
    })
    .select("id, product_id, expires_at")
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not start studio.");
  const quote = await quoteImageStudio();
  const remaining = await getAiCreditsRemaining(supabase, ctx.organizationId);
  return { session: data, quote, creditsRemaining: remaining };
}

export async function uploadStudioSource(
  supabase: SupabaseClient,
  ctx: TenantContext,
  sessionId: string,
  file: File
) {
  assertImageFile(file);
  const session = await requireSession(supabase, ctx, sessionId);
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${ctx.organizationId}/ai-studio/${session.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: "3600",
  });
  if (uploadError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, uploadError.message);
  const { data, error } = await supabase
    .from("ai_image_assets")
    .insert({
      organization_id: ctx.organizationId,
      session_id: session.id,
      kind: "source",
      role: "main",
      storage_path: path,
    })
    .select("id, kind, storage_path")
    .single();
  if (error || !data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not save source photo.");
  return {
    id: data.id,
    kind: data.kind,
    url: productImagePublicUrl(data.storage_path),
  };
}

export async function listStudioSession(supabase: SupabaseClient, ctx: TenantContext, sessionId: string) {
  const session = await requireSession(supabase, ctx, sessionId);
  const { data: assets } = await supabase
    .from("ai_image_assets")
    .select("id, kind, role, storage_path, selected_for_gallery, job_id")
    .eq("session_id", session.id)
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: true });
  const { data: jobs } = await supabase
    .from("ai_image_jobs")
    .select("id, status, preset, aspect, role, variation_count, credit_qty, error_message, created_at")
    .eq("session_id", session.id)
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false })
    .limit(20);
  return {
    session,
    assets: (assets ?? []).map((asset) => ({
      ...asset,
      url: productImagePublicUrl(asset.storage_path),
    })),
    jobs: jobs ?? [],
  };
}

export async function enqueueImageStudioJob(
  supabase: SupabaseClient,
  ctx: TenantContext,
  body: z.infer<typeof createJobSchema>
) {
  const config = await getImageStudioConfig();
  if (!config.enabled || !config.apiKey) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "AI Image Studio is not configured.");
  }
  const session = await requireSession(supabase, ctx, body.sessionId);
  const variations = Math.min(body.variationCount, config.maxVariations);
  const creditQty = config.creditCost * variations;

  const { data: source } = await supabase
    .from("ai_image_assets")
    .select("id, kind, storage_path")
    .eq("id", body.sourceAssetId)
    .eq("session_id", session.id)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (!source || source.kind !== "source") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose an original photo to enhance.");
  }

  const { count } = await supabase
    .from("ai_image_jobs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId)
    .in("status", ["QUEUED", "RUNNING"]);
  if ((count ?? 0) >= 1) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Wait for the current image job to finish.");
  }

  const remaining = await getAiCreditsRemaining(supabase, ctx.organizationId);
  if (remaining < creditQty) {
    throw new AppError(ERROR_CODES.CONFLICT, ZERO_AI_CREDITS_MESSAGE);
  }

  if (body.preset === "custom" && !body.customPrompt?.trim()) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Add a custom instruction for Custom AI Edit.");
  }

  const offer: OfferOverlayInput | undefined = body.offer
    ? {
        ...body.offer,
        compareAtPaise: body.offer.compareAtPaise ?? null,
      }
    : undefined;
  if (offer) {
    offerDiscountPercent(offer.pricePaise ?? 0, offer.compareAtPaise);
  }

  const reservation = await reserveAiCredits(supabase, ctx.organizationId, {
    qty: creditQty,
    reason: AI_CREDIT_REASON_IMAGE_STUDIO,
    idempotencyKey: body.idempotencyKey,
  });
  if (!reservation.reserved && reservation.status === "INSUFFICIENT") {
    throw new AppError(ERROR_CODES.CONFLICT, ZERO_AI_CREDITS_MESSAGE);
  }
  if (!reservation.reserved && !reservation.duplicate) {
    throw new AppError(ERROR_CODES.CONFLICT, ZERO_AI_CREDITS_MESSAGE);
  }

  const { data: existing } = await supabase
    .from("ai_image_jobs")
    .select("id, status, credit_qty, background_job_id")
    .eq("organization_id", ctx.organizationId)
    .eq("idempotency_key", body.idempotencyKey)
    .maybeSingle();
  if (existing) {
    return { jobId: existing.id, status: existing.status, creditQty: existing.credit_qty, creditsRemaining: reservation.remaining };
  }

  const { data: job, error } = await supabase
    .from("ai_image_jobs")
    .insert({
      organization_id: ctx.organizationId,
      session_id: session.id,
      source_asset_id: source.id,
      preset: body.preset,
      festival: body.festival ?? null,
      aspect: body.aspect,
      role: body.role,
      custom_prompt: body.customPrompt ?? null,
      category_hint: body.categoryHint ?? null,
      variation_count: variations,
      credit_qty: creditQty,
      status: "QUEUED",
      model: config.model,
      idempotency_key: body.idempotencyKey,
      offer: offer ?? {},
      prompt_meta: { preset: body.preset, aspect: body.aspect, role: body.role },
    })
    .select("id")
    .single();
  if (error || !job) {
    await releaseAiCreditReservation(supabase, ctx.organizationId, body.idempotencyKey);
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not queue image job.");
  }

  try {
    const bg = await createBackgroundJob(supabase, {
      organizationId: ctx.organizationId,
      jobType: "ai-image",
      entityType: "ai_image_job",
      entityId: job.id,
      userId: ctx.userId,
      progress: { aiImageJobId: job.id, idempotencyKey: body.idempotencyKey },
    });
    await supabase.from("ai_image_jobs").update({ background_job_id: bg.id }).eq("id", job.id);
    await runQueuedJobsNow([claimedJobFromRow(bg)]);
  } catch (error) {
    await releaseAiCreditReservation(supabase, ctx.organizationId, body.idempotencyKey);
    await supabase.from("ai_image_jobs").update({ status: "FAILED", error_message: "Could not queue the image job." }).eq("id", job.id);
    throw error;
  }
  return { jobId: job.id, status: "QUEUED", creditQty, creditsRemaining: reservation.remaining };
}

export async function enqueueCoverJob(
  supabase: SupabaseClient,
  ctx: TenantContext,
  body: z.infer<typeof createCoverJobSchema>
) {
  const config = await getImageStudioConfig();
  if (!config.enabled || !config.apiKey) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "AI Image Studio is not configured.");
  }
  const session = await requireSession(supabase, ctx, body.sessionId);
  const variations = Math.min(body.variationCount, config.maxVariations);
  const variants = [...new Set(body.variants)];
  const creditQty = config.coverCreditCost * variations * variants.length;

  const { data: source } = await supabase
    .from("ai_image_assets")
    .select("id, kind, storage_path")
    .eq("id", body.sourceAssetId)
    .eq("session_id", session.id)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (!source || source.kind !== "source") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose an original photo to enhance.");
  }

  const { count } = await supabase
    .from("ai_image_jobs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId)
    .in("status", ["QUEUED", "RUNNING"]);
  if ((count ?? 0) >= 1) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Wait for the current image job to finish.");
  }

  const remaining = await getAiCreditsRemaining(supabase, ctx.organizationId);
  if (remaining < creditQty) {
    throw new AppError(ERROR_CODES.CONFLICT, ZERO_AI_CREDITS_MESSAGE);
  }
  if (body.preset === "custom" && !body.customPrompt?.trim()) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Add a custom instruction for Custom AI Design.");
  }

  const reservation = await reserveAiCredits(supabase, ctx.organizationId, {
    qty: creditQty,
    reason: AI_CREDIT_REASON_IMAGE_STUDIO,
    idempotencyKey: body.idempotencyKey,
  });
  if (!reservation.reserved && reservation.status === "INSUFFICIENT") {
    throw new AppError(ERROR_CODES.CONFLICT, ZERO_AI_CREDITS_MESSAGE);
  }
  if (!reservation.reserved && !reservation.duplicate) {
    throw new AppError(ERROR_CODES.CONFLICT, ZERO_AI_CREDITS_MESSAGE);
  }

  const { data: existing } = await supabase
    .from("ai_image_jobs")
    .select("id, status, credit_qty, background_job_id")
    .eq("organization_id", ctx.organizationId)
    .eq("idempotency_key", body.idempotencyKey)
    .maybeSingle();
  if (existing) {
    return {
      jobId: existing.id,
      status: existing.status,
      creditQty: existing.credit_qty,
      creditsRemaining: reservation.remaining,
      identityRisk: identityRiskForEnhance(body.enhance),
    };
  }

  const { data: job, error } = await supabase
    .from("ai_image_jobs")
    .insert({
      organization_id: ctx.organizationId,
      session_id: session.id,
      source_asset_id: source.id,
      preset: body.preset,
      festival: body.festival ?? null,
      aspect: variants.includes("mobile") && variants.length === 1 ? "4:5" : "16:9",
      role: "banner",
      purpose: "cover",
      cover_type: body.coverType ?? "homepage_hero",
      custom_prompt: body.customPrompt ?? null,
      category_hint: body.categoryHint ?? null,
      variation_count: variations,
      credit_qty: creditQty,
      status: "QUEUED",
      model: config.model,
      idempotency_key: body.idempotencyKey,
      brief: {
        variants,
        enhance: body.enhance ?? null,
        coverId: body.coverId ?? null,
      },
      prompt_meta: { preset: body.preset, purpose: "cover", variants },
    })
    .select("id")
    .single();
  if (error || !job) {
    await releaseAiCreditReservation(supabase, ctx.organizationId, body.idempotencyKey);
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not queue cover job.");
  }

  try {
    const bg = await createBackgroundJob(supabase, {
      organizationId: ctx.organizationId,
      jobType: "ai-image",
      entityType: "ai_image_job",
      entityId: job.id,
      userId: ctx.userId,
      progress: { aiImageJobId: job.id, idempotencyKey: body.idempotencyKey },
    });
    await supabase.from("ai_image_jobs").update({ background_job_id: bg.id }).eq("id", job.id);
    await runQueuedJobsNow([claimedJobFromRow(bg)]);
  } catch (error) {
    await releaseAiCreditReservation(supabase, ctx.organizationId, body.idempotencyKey);
    await supabase.from("ai_image_jobs").update({ status: "FAILED", error_message: "Could not queue the cover job." }).eq("id", job.id);
    throw error;
  }
  return {
    jobId: job.id,
    status: "QUEUED",
    creditQty,
    creditsRemaining: reservation.remaining,
    identityRisk: identityRiskForEnhance(body.enhance),
  };
}

export async function getImageStudioJob(supabase: SupabaseClient, ctx: TenantContext, jobId: string) {
  const { data: job, error } = await supabase
    .from("ai_image_jobs")
    .select(
      "id, status, preset, aspect, role, variation_count, credit_qty, error_message, created_at, session_id"
    )
    .eq("id", jobId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!job) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Image job not found.");
  const { data: assets } = await supabase
    .from("ai_image_assets")
    .select("id, kind, role, storage_path, selected_for_gallery")
    .eq("job_id", jobId)
    .eq("organization_id", ctx.organizationId);
  return {
    ...job,
    assets: (assets ?? []).map((asset) => ({
      ...asset,
      storagePath: asset.storage_path,
      url: productImagePublicUrl(asset.storage_path),
    })),
  };
}

export async function selectGeneratedAssets(
  supabase: SupabaseClient,
  ctx: TenantContext,
  jobId: string,
  assetIds: string[]
) {
  const job = await getImageStudioJob(supabase, ctx, jobId);
  await supabase
    .from("ai_image_assets")
    .update({ selected_for_gallery: false })
    .eq("job_id", jobId)
    .eq("organization_id", ctx.organizationId)
    .eq("kind", "generated");
  if (assetIds.length) {
    const { error } = await supabase
      .from("ai_image_assets")
      .update({ selected_for_gallery: true })
      .eq("organization_id", ctx.organizationId)
      .eq("kind", "generated")
      .in("id", assetIds.slice(0, MAX_PRODUCT_IMAGES));
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
  return getImageStudioJob(supabase, ctx, job.id);
}

export async function attachSelectedToProduct(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: z.infer<typeof attachSchema>
) {
  const session = await requireSession(supabase, ctx, input.sessionId);
  const { data: assets } = await supabase
    .from("ai_image_assets")
    .select("id, storage_path, kind")
    .eq("session_id", session.id)
    .eq("organization_id", ctx.organizationId)
    .in("id", input.assetIds);
  const generated = (assets ?? []).filter((asset) => asset.kind === "generated");
  if (!generated.length) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select generated photos first.");

  const { getProduct } = await import("@/modules/products/service");
  const product = await getProduct(supabase, ctx, input.productId);
  const current = product.imagePaths ?? [];
  const next = [...current];

  for (const asset of generated.slice(0, MAX_PRODUCT_IMAGES)) {
    const { data } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).download(asset.storage_path);
    if (!data) continue;
    const bytes = Buffer.from(await data.arrayBuffer());
    const dest = `${ctx.organizationId}/${input.productId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
    const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(dest, bytes, {
      contentType: "image/png",
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    if (next.length < MAX_PRODUCT_IMAGES) next.push(dest);
    else next[next.length - 1] = dest;
  }
  const { error } = await supabase
    .from("products")
    .update({ image_urls: next.slice(0, MAX_PRODUCT_IMAGES) })
    .eq("id", input.productId)
    .eq("organization_id", ctx.organizationId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return getProduct(supabase, ctx, input.productId);
}
