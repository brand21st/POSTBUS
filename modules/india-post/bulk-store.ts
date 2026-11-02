import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuiltBulkBatch } from "@/modules/india-post/bulk-batch-build";
import { recordIndiaPostBulkMetric } from "@/modules/india-post/bulk-metrics";
import type { IndiaPostBulkBatchStatus } from "@/modules/india-post/bulk-state";
import { canTransitionIndiaPostBulkBatch } from "@/modules/india-post/bulk-state";

type Admin = SupabaseClient;

export async function loadBulkBatchByJobId(supabase: Admin, jobId: string) {
  const { data, error } = await supabase
    .from("india_post_bulk_batches")
    .select("id, status, article_count, organization_id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; status: IndiaPostBulkBatchStatus; article_count: number; organization_id: string } | null;
}

export async function persistReadyBulkBatch(
  supabase: Admin,
  batch: BuiltBulkBatch,
  jobId: string | null
) {
  const rpc = await supabase.rpc("create_india_post_bulk_batch", {
    p_organization_id: batch.organizationId,
    p_india_post_customer_id: batch.indiaPostCustomerId,
    p_contract_id: batch.contractId,
    p_service_code: batch.serviceCode,
    p_environment: batch.environment,
    p_request_fingerprint: batch.requestFingerprint,
    p_job_id: jobId,
    p_shipment_ids: batch.shipmentIds,
    p_barcodes: batch.barcodes.map((value) => value ?? ""),
  });
  if (!rpc.error && rpc.data) {
    recordIndiaPostBulkMetric("bulk_batches_started", {
      batchId: rpc.data,
      organizationId: batch.organizationId,
      articleCount: batch.shipmentIds.length,
    });
    return rpc.data as string;
  }
  if (rpc.error && !/does not exist|42883|PGRST202/i.test(rpc.error.message ?? "")) {
    recordIndiaPostBulkMetric("bulk_duplicates_prevented", {
      organizationId: batch.organizationId,
      message: rpc.error.message,
    });
    throw Object.assign(new Error(rpc.error.message), { code: "VALIDATION_ERROR" });
  }
  const { data, error } = await supabase
    .from("india_post_bulk_batches")
    .insert({
      organization_id: batch.organizationId,
      india_post_customer_id: batch.indiaPostCustomerId,
      contract_id: batch.contractId,
      service_code: batch.serviceCode,
      environment: batch.environment,
      status: "READY",
      article_count: batch.shipmentIds.length,
      request_fingerprint: batch.requestFingerprint,
      job_id: jobId,
    })
    .select("id")
    .single();
  if (error || !data) {
    recordIndiaPostBulkMetric("bulk_duplicates_prevented", {
      organizationId: batch.organizationId,
      message: error?.message ?? "insert failed",
    });
    throw Object.assign(new Error(error?.message || "Could not persist bulk batch."), {
      code: "VALIDATION_ERROR",
    });
  }
  const members = batch.shipmentIds.map((shipmentId, position) => ({
    batch_id: data.id,
    organization_id: batch.organizationId,
    shipment_id: shipmentId,
    barcode: batch.barcodes[position] ?? null,
    article_result: "PENDING",
    position,
  }));
  const inserted = await supabase.from("india_post_bulk_batch_articles").insert(members);
  if (inserted.error) {
    await supabase.from("india_post_bulk_batches").update({ status: "FAILED", last_error: inserted.error.message }).eq("id", data.id);
    throw Object.assign(new Error(inserted.error.message), { code: "VALIDATION_ERROR" });
  }
  recordIndiaPostBulkMetric("bulk_batches_started", {
    batchId: data.id,
    organizationId: batch.organizationId,
    articleCount: batch.shipmentIds.length,
  });
  return data.id as string;
}

export async function transitionBulkBatch(
  supabase: Admin,
  batchId: string,
  from: IndiaPostBulkBatchStatus,
  to: IndiaPostBulkBatchStatus,
  fields?: Record<string, unknown>
) {
  if (!canTransitionIndiaPostBulkBatch(from, to)) {
    throw Object.assign(new Error(`Illegal bulk transition ${from} → ${to}`), { code: "VALIDATION_ERROR" });
  }
  const { data, error } = await supabase
    .from("india_post_bulk_batches")
    .update({ status: to, ...fields })
    .eq("id", batchId)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function persistBulkArticleResults(
  supabase: Admin,
  batchId: string,
  input: {
    bookedIds: string[];
    failedIds: string[];
    recoveryIds?: string[];
    ceptBatchId?: string | null;
    correlationId?: string | null;
  }
) {
  if (input.ceptBatchId || input.correlationId) {
    await supabase
      .from("india_post_bulk_batches")
      .update({
        cept_batch_id: input.ceptBatchId ?? undefined,
        correlation_id: input.correlationId ?? undefined,
      })
      .eq("id", batchId);
  }
  for (const shipmentId of input.bookedIds) {
    await supabase
      .from("india_post_bulk_batch_articles")
      .update({ article_result: "SUCCEEDED" })
      .eq("batch_id", batchId)
      .eq("shipment_id", shipmentId);
  }
  for (const shipmentId of input.failedIds) {
    await supabase
      .from("india_post_bulk_batch_articles")
      .update({ article_result: "FAILED" })
      .eq("batch_id", batchId)
      .eq("shipment_id", shipmentId);
  }
  for (const shipmentId of input.recoveryIds ?? []) {
    await supabase
      .from("india_post_bulk_batch_articles")
      .update({ article_result: "RECOVERY_REQUIRED" })
      .eq("batch_id", batchId)
      .eq("shipment_id", shipmentId);
  }
}

export function uncertainBulkMustRecoverWithoutPost(status: IndiaPostBulkBatchStatus) {
  return (
    status === "SUBMITTING" ||
    status === "SUBMITTED" ||
    status === "RECONCILING" ||
    status === "RECOVERY_REQUIRED"
  );
}
