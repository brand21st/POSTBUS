import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import { isMerchantWebhooksOpenForOrg } from "@/modules/merchant-api/flags";
import { buildPostBusTrackingUrl } from "@/modules/tracking-pages/host";
import { createBackgroundJob } from "@/modules/jobs/service";
import { buildWebhookEnvelope, type MerchantWebhookEvent, type WebhookEventData } from "@/modules/webhooks/catalog";

export function publicEventId() {
  return `evt_${randomUUID()}`;
}

export async function recordWebhookEvent(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    type: MerchantWebhookEvent | "webhook.test";
    resourceType: string;
    resourceId?: string | null;
    dedupeKey: string;
    data: WebhookEventData;
  }
) {
  if (!isMerchantWebhooksOpenForOrg(input.organizationId)) return { recorded: false as const };
  const id = publicEventId();
  const createdAt = new Date().toISOString();
  const payload = buildWebhookEnvelope({ id, type: input.type, createdAt, data: input.data });
  try {
    const { error } = await supabase.from("webhook_events").insert({
      id: id.slice(4),
      organization_id: input.organizationId,
      event_type: input.type,
      resource_type: input.resourceType,
      resource_id: input.resourceId ?? null,
      dedupe_key: input.dedupeKey,
      payload,
      status: "PENDING",
    });
    if (error) {
      if (error.code === "23505") return { recorded: false as const, duplicate: true };
      logError("webhook.outbox_insert_failed", { message: error.message, type: input.type });
      return { recorded: false as const };
    }
    try {
      await createBackgroundJob(supabase, {
        organizationId: input.organizationId,
        jobType: "webhook-processing",
        entityType: "webhook_event",
        entityId: id.slice(4),
        progress: { event: input.type },
      });
    } catch (error) {
      logError("webhook.job_enqueue_failed", {
        message: error instanceof Error ? error.message : "enqueue failed",
        type: input.type,
      });
    }
    return { recorded: true as const, id };
  } catch (error) {
    logError("webhook.outbox_insert_failed", {
      message: error instanceof Error ? error.message : "insert failed",
      type: input.type,
    });
    return { recorded: false as const };
  }
}

export function trackingUrlForAwb(awb?: string | null) {
  return awb ? buildPostBusTrackingUrl(awb) : null;
}
