import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { generateAndStoreOfficialIndiaPostLabelPdf } from "@/modules/labels/official-fetch";
import { persistPackingSlip } from "@/modules/labels/packing-fetch";
import { findReadyIndiaPostLabel, findReadyMerchantLabel } from "@/modules/labels/ready";

export const RETRY_INCOMPLETE_MAX = 20;

export type RetryIncompleteResult = {
  skipped: boolean;
  generatedOfficial: boolean;
  shipmentId: string;
  indiaPostLabelId: string;
  packingLabelId: string;
  message: string;
};

export type RetryIncompleteBatchItem = {
  labelId?: string;
  shipmentId?: string;
  skipped?: boolean;
  generatedOfficial?: boolean;
  indiaPostLabelId?: string;
  packingLabelId?: string;
  message?: string;
  error?: string;
};

export type RetryIncompleteBatch = {
  retried: number;
  failed: number;
  skipped: number;
  results: RetryIncompleteBatchItem[];
};

function packingSlipFailure(error: unknown) {
  if (error instanceof AppError) return error;
  const raw = error instanceof Error ? error.message.split("\n")[0].trim() : "";
  const missingCanvas = /@napi-rs\/canvas|Cannot find module/i.test(raw);
  return new AppError(
    ERROR_CODES.LABEL_GENERATION_FAILED,
    missingCanvas
      ? "Could not generate the packing slip. Unicode text rendering is unavailable on this server."
      : raw && raw.length <= 200 && !/Require stack|node_modules/i.test(raw)
        ? raw
        : "Could not generate the packing slip."
  );
}

function asIdList(ids: unknown) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of ids) {
    const id = String(value ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

export async function retryIncompleteShipmentLabels(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string
): Promise<RetryIncompleteResult> {
  const india = await findReadyIndiaPostLabel(supabase, organizationId, shipmentId);
  const packing = await findReadyMerchantLabel(supabase, organizationId, shipmentId);
  if (india && packing) {
    return {
      skipped: true,
      generatedOfficial: false,
      shipmentId,
      indiaPostLabelId: india.id,
      packingLabelId: packing.id,
      message: "Both label files are already ready.",
    };
  }

  let indiaPostLabelId = india?.id ?? "";
  let generatedOfficial = false;
  if (!india) {
    const created = await generateAndStoreOfficialIndiaPostLabelPdf(supabase, organizationId, shipmentId);
    if (!created.labelId) {
      throw new AppError(ERROR_CODES.LABEL_GENERATION_FAILED, "Could not save the India Post label.");
    }
    indiaPostLabelId = created.labelId;
    generatedOfficial = true;
  }

  try {
    const saved = await persistPackingSlip(supabase, organizationId, shipmentId);
    return {
      skipped: false,
      generatedOfficial,
      shipmentId,
      indiaPostLabelId,
      packingLabelId: saved.id,
      message: generatedOfficial
        ? "India Post label and packing slip were generated."
        : "Packing slip was generated.",
    };
  } catch (error) {
    throw packingSlipFailure(error);
  }
}

export async function retryIncompleteLabelById(
  supabase: SupabaseClient,
  organizationId: string,
  labelId: string
) {
  const { data: existing } = await supabase
    .from("labels")
    .select("id, shipment_id")
    .eq("organization_id", organizationId)
    .eq("id", labelId)
    .maybeSingle();
  if (!existing?.shipment_id) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Label not found.");
  }
  return retryIncompleteShipmentLabels(supabase, organizationId, String(existing.shipment_id));
}

export async function retryIncompleteLabelsByIds(
  supabase: SupabaseClient,
  organizationId: string,
  ids: unknown
): Promise<RetryIncompleteBatch> {
  const uniqueIds = asIdList(ids);
  if (!uniqueIds.length) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select at least one incomplete label.");
  }
  if (uniqueIds.length > RETRY_INCOMPLETE_MAX) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `Retry at most ${RETRY_INCOMPLETE_MAX} labels at a time.`
    );
  }

  const { data: rows, error } = await supabase
    .from("labels")
    .select("id, shipment_id")
    .eq("organization_id", organizationId)
    .in("id", uniqueIds);
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }

  const shipmentByLabel = new Map(
    (rows ?? [])
      .filter((row) => row?.id && row?.shipment_id)
      .map((row) => [String(row.id), String(row.shipment_id)])
  );
  const results: RetryIncompleteBatchItem[] = [];
  const seenShipments = new Set<string>();
  let retried = 0;
  let failed = 0;
  let skipped = 0;

  for (const labelId of uniqueIds) {
    const shipmentId = shipmentByLabel.get(labelId);
    if (!shipmentId) {
      failed += 1;
      results.push({ labelId, error: "Label not found." });
      continue;
    }
    if (seenShipments.has(shipmentId)) continue;
    seenShipments.add(shipmentId);
    try {
      const result = await retryIncompleteShipmentLabels(supabase, organizationId, shipmentId);
      if (result.skipped) skipped += 1;
      else retried += 1;
      results.push({
        labelId,
        shipmentId: result.shipmentId,
        skipped: result.skipped,
        generatedOfficial: result.generatedOfficial,
        indiaPostLabelId: result.indiaPostLabelId,
        packingLabelId: result.packingLabelId,
        message: result.message,
      });
    } catch (caught) {
      failed += 1;
      results.push({
        labelId,
        shipmentId,
        error: caught instanceof Error ? caught.message : "Could not generate the missing label files.",
      });
    }
  }

  return { retried, failed, skipped, results };
}
