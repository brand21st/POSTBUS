import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueJob } from "@/lib/queue/queues";
import { usesDatabaseJobRunner } from "@/lib/env";
import { logError, logInfo } from "@/lib/logger";
import type { JobType } from "@/types/domain";

export const ACTIVE_SHIPMENT_BOOKING_JOB_STATUSES = ["PENDING", "QUEUED", "RUNNING", "RETRYING"] as const;

function rpcMissing(error: { code?: string; message?: string } | null) {
  const message = String(error?.message ?? "");
  return (
    error?.code === "42883" ||
    error?.code === "42501" ||
    /does not exist|could not find the function|permission denied/i.test(message)
  );
}

function uniqueViolation(error: { code?: string; message?: string } | null) {
  const message = String(error?.message ?? "");
  return error?.code === "23505" || /duplicate key|unique constraint/i.test(message);
}

export async function loadActiveShipmentBookingJob(
  supabase: SupabaseClient,
  input: { organizationId: string; entityId: string }
) {
  const { data, error } = await supabase
    .from("background_jobs")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("job_type", "shipment-booking")
    .eq("entity_type", "shipment")
    .eq("entity_id", input.entityId)
    .in("status", [...ACTIVE_SHIPMENT_BOOKING_JOB_STATUSES])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function enqueueBullMqIfNeeded(
  supabase: SupabaseClient,
  job: { id: string },
  input: {
    organizationId: string;
    jobType: JobType;
    entityType?: string;
    entityId?: string;
    shipmentIds?: string[];
    userId?: string;
  }
) {
  if (usesDatabaseJobRunner()) return;
  try {
    await enqueueJob(input.jobType, {
      organizationId: input.organizationId,
      jobId: job.id,
      entityType: input.entityType,
      entityId: input.entityId,
      shipmentIds: input.shipmentIds,
      userId: input.userId,
    });
  } catch (queueError) {
    logError("queue.enqueue_failed", {
      jobId: job.id,
      message: queueError instanceof Error ? queueError.message : "redis unavailable",
    });
    await supabase
      .from("background_jobs")
      .update({
        last_error: "Redis is unreachable. Set JOB_RUNNER=database or start the BullMQ workers.",
        last_error_code: "QUEUE_UNAVAILABLE",
      })
      .eq("id", job.id);
  }
}

export async function enqueueShipmentBookingJob(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    jobType: JobType;
    entityType?: string;
    entityId?: string;
    shipmentIds?: string[];
    userId?: string;
    progress?: Record<string, unknown>;
  }
) {
  const entityId = input.entityId;
  if (!entityId) {
    throw new Error("shipment-booking jobs require entityId.");
  }
  const progress = input.progress ?? (input.shipmentIds ? { shipmentIds: input.shipmentIds } : {});

  if (typeof supabase.rpc === "function") {
    const { data, error } = await supabase.rpc("enqueue_shipment_booking_job", {
      p_organization_id: input.organizationId,
      p_entity_id: entityId,
      p_user_id: input.userId ?? null,
      p_progress: progress,
    });
    if (!error && data) {
      const row = Array.isArray(data) ? data[0] : data;
      logInfo("booking.job_enqueued", {
        organizationId: input.organizationId,
        shipmentId: entityId,
        jobId: row?.id,
      });
      await enqueueBullMqIfNeeded(supabase, row, input);
      return row;
    }
    if (error && !rpcMissing(error) && !uniqueViolation(error)) {
      throw new Error(error.message || "Could not enqueue booking job.");
    }
  }

  const existing = await loadActiveShipmentBookingJob(supabase, {
    organizationId: input.organizationId,
    entityId,
  });
  if (existing) {
    logInfo("booking.job_already_active", {
      organizationId: input.organizationId,
      shipmentId: entityId,
      jobId: existing.id,
    });
    return existing;
  }

  const { data, error } = await supabase
    .from("background_jobs")
    .insert({
      organization_id: input.organizationId,
      job_type: input.jobType,
      entity_type: input.entityType ?? "shipment",
      entity_id: entityId,
      status: "QUEUED",
      created_by: input.userId ?? null,
      progress,
    })
    .select()
    .single();

  if (uniqueViolation(error)) {
    const raced = await loadActiveShipmentBookingJob(supabase, {
      organizationId: input.organizationId,
      entityId,
    });
    if (raced) return raced;
  }

  if (error || !data) {
    throw new Error(error?.message || "Could not create background job.");
  }

  await enqueueBullMqIfNeeded(supabase, data, input);
  return data;
}
