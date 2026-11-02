import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { buildIndiaPostBulkBatches, type BuiltBulkBatch } from "@/modules/india-post/bulk-batch-build";
import { indiaPostBulkMaxArticles } from "@/modules/india-post/bulk-config";
import type { BulkCandidate } from "@/modules/india-post/bulk-eligibility";
import { persistReadyBulkBatch } from "@/modules/india-post/bulk-store";
import { createBackgroundJob } from "@/modules/jobs/service";

export type BulkEnginePlan = {
  batches: BuiltBulkBatch[];
  leftoverShipmentIds: string[];
};

/**
 * Plans controlled CEPT batches. 100k articles means many batches of
 * INDIA_POST_BULK_MAX_ARTICLES, never one HTTP body of 100k.
 */
export function planIndiaPostBulkWork(
  rows: BulkCandidate[],
  options?: { maxArticles?: number; activeShipmentIds?: Set<string> }
): BulkEnginePlan {
  const built = buildIndiaPostBulkBatches(rows, {
    maxArticles: options?.maxArticles ?? indiaPostBulkMaxArticles(),
    activeShipmentIds: options?.activeShipmentIds,
  });
  return {
    batches: built.batches,
    leftoverShipmentIds: built.leftovers.map((row) => row.shipmentId),
  };
}

export async function enqueueIndiaPostBulkPlan(
  supabase: SupabaseClient,
  ctx: TenantContext,
  plan: BulkEnginePlan
) {
  const jobs = [];
  for (const shipmentId of plan.leftoverShipmentIds) {
    jobs.push(
      await createBackgroundJob(supabase, {
        organizationId: ctx.organizationId,
        jobType: "shipment-booking",
        entityType: "shipment",
        entityId: shipmentId,
        userId: ctx.userId,
      })
    );
  }
  for (const batch of plan.batches) {
    const job = await createBackgroundJob(supabase, {
      organizationId: ctx.organizationId,
      jobType: "shipment-booking",
      entityType: "shipment",
      entityId: batch.shipmentIds[0],
      shipmentIds: batch.shipmentIds,
      userId: ctx.userId,
    });
    await persistReadyBulkBatch(supabase, batch, job.id);
    jobs.push(job);
  }
  return jobs;
}

export function candidatesFromQueuedShipments(
  rows: Array<{
    id: string;
    organization_id: string;
    barcode?: string | null;
    service_code?: string | null;
    status: string;
    created_at?: string | null;
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
    weight_grams?: number | null;
  }>,
  connection: {
    id?: string;
    bulk_customer_id?: string | null;
    environment?: string | null;
    pickup_office_id?: string | null;
  },
  contractByService: Record<string, string>
): BulkCandidate[] {
  return rows.map((row) => {
    const serviceCode = String(row.service_code || "SP_INLAND_PARCEL");
    return {
      shipmentId: row.id,
      jobId: row.id,
      organizationId: row.organization_id,
      indiaPostConnectionId: connection.id,
      indiaPostCustomerId: String(connection.bulk_customer_id ?? ""),
      contractId: contractByService[serviceCode] || "",
      serviceCode,
      articleType: serviceCode,
      officeId: String(connection.pickup_office_id ?? ""),
      environment: connection.environment === "UAT" ? "UAT" : "PRODUCTION",
      createdAt: row.created_at || new Date(0).toISOString(),
      barcode: row.barcode ?? null,
      lengthCm: Number(row.length_cm) || 0,
      widthCm: Number(row.width_cm) || 0,
      heightCm: Number(row.height_cm) || 0,
      weightGrams: Number(row.weight_grams) || 0,
      status: row.status,
    };
  });
}
