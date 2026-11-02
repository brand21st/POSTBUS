import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import { finalizeAiCreditReservation, releaseAiCreditReservation } from "@/modules/ai-credits/service";
import { getImageStudioConfig } from "@/modules/ai-image/config";
import {
  buildCoverEditPrompt,
  type CoverEnhanceAction,
  type CoverFestival,
  type CoverPreset,
  type CoverType,
} from "@/modules/ai-image/cover-presets";
import { composeOfferPoster } from "@/modules/ai-image/offer-compose";
import { bufferToDataUrl, editProductImage } from "@/modules/ai-image/openrouter-image";
import { buildEditPrompt, type AiImageAspect, type AiImagePreset, type AiImageRole, type FestivalTheme } from "@/modules/ai-image/presets";
import { PRODUCT_IMAGE_BUCKET } from "@/modules/products/images";

export async function processAiImageJob(supabase: SupabaseClient, organizationId: string, jobId: string) {
  const { data: job, error } = await supabase
    .from("ai_image_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !job) throw new Error(error?.message || "AI image job not found.");

  const idempotencyKey = String(job.idempotency_key);
  await supabase.from("ai_image_jobs").update({ status: "RUNNING", error_message: null }).eq("id", jobId);

  try {
    const config = await getImageStudioConfig();
    if (!config.apiKey) throw new Error("OpenRouter is not connected.");

    const { data: source } = await supabase
      .from("ai_image_assets")
      .select("storage_path")
      .eq("id", job.source_asset_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!source?.storage_path) throw new Error("Source photo is missing.");
    const downloaded = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).download(source.storage_path);
    if (downloaded.error || !downloaded.data) throw new Error("Could not read the original photo.");
    const sourceBytes = Buffer.from(await downloaded.data.arrayBuffer());
    const dataUrl = bufferToDataUrl(sourceBytes, "image/png");

    const isCover = String(job.purpose ?? "product") === "cover";
    const brief = (job.brief && typeof job.brief === "object" ? job.brief : {}) as {
      variants?: Array<"desktop" | "mobile">;
      enhance?: CoverEnhanceAction | null;
    };
    const variants: Array<"desktop" | "mobile"> = isCover
      ? (brief.variants?.length ? brief.variants : ["desktop"])
      : ["desktop"];

    const count = Math.max(1, Math.min(3, Number(job.variation_count) || 1));
    for (const variant of variants) {
    for (let index = 0; index < count; index++) {
      const prompt = isCover
        ? buildCoverEditPrompt({
            preset: job.preset as CoverPreset,
            festival: (job.festival as CoverFestival | null) ?? null,
            enhance: brief.enhance ?? null,
            customPrompt: job.custom_prompt,
            categoryHint: job.category_hint,
            coverType: (job.cover_type as CoverType | null) ?? null,
            variant,
          })
        : buildEditPrompt({
            preset: job.preset as AiImagePreset,
            festival: (job.festival as FestivalTheme | null) ?? null,
            customPrompt: job.custom_prompt,
            categoryHint: job.category_hint,
            role: job.role as AiImageRole,
          });
      const aspect: AiImageAspect = isCover ? (variant === "mobile" ? "4:5" : "16:9") : (job.aspect as AiImageAspect);
      let png = await editProductImage({
        apiKey: config.apiKey,
        model: String(job.model || config.model),
        prompt,
        imageDataUrl: dataUrl,
        aspect,
      });
      if (!isCover && job.role === "offer" && job.offer && typeof job.offer === "object") {
        const offer = job.offer as {
          productName?: string;
          pricePaise?: number;
          compareAtPaise?: number | null;
          headline?: string | null;
          cta?: string | null;
          expiry?: string | null;
        };
        if (offer.productName) {
          png = await composeOfferPoster(png, {
            productName: offer.productName,
            pricePaise: offer.pricePaise,
            compareAtPaise: offer.compareAtPaise,
            headline: offer.headline,
            cta: offer.cta,
            expiry: offer.expiry,
          });
        }
      }
      const path = `${organizationId}/ai-studio/${job.session_id}/gen-${jobId.slice(0, 8)}-${variant}-${index}.png`;
      const upload = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, png, {
        contentType: "image/png",
        upsert: true,
        cacheControl: "3600",
      });
      if (upload.error) throw new Error(upload.error.message);
      await supabase.from("ai_image_assets").insert({
        organization_id: organizationId,
        session_id: job.session_id,
        job_id: jobId,
        kind: "generated",
        role: isCover ? variant : job.role,
        storage_path: path,
      });
    }
    }

    await finalizeAiCreditReservation(supabase, organizationId, idempotencyKey);
    await supabase.from("ai_image_jobs").update({ status: "SUCCEEDED", error_message: null }).eq("id", jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image generation failed.";
    logError("ai_image.job_failed", { jobId, organizationId, message });
    await releaseAiCreditReservation(supabase, organizationId, idempotencyKey);
    await supabase.from("ai_image_jobs").update({ status: "FAILED", error_message: message }).eq("id", jobId);
    throw error;
  }
}
