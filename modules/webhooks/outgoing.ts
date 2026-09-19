import { createHmac } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBackgroundJob } from "@/modules/jobs/service";

export async function emitWebhook(
  supabase: SupabaseClient,
  organizationId: string,
  event: string,
  payload: Record<string, unknown>
) {
  const { data: endpoints } = await supabase
    .from("webhook_endpoints")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  for (const endpoint of endpoints ?? []) {
    if (endpoint.events?.length && !endpoint.events.includes(event)) continue;
    await supabase.from("webhook_deliveries").insert({
      organization_id: organizationId,
      endpoint_id: endpoint.id,
      event,
      payload,
      status: "PENDING",
    });
    await createBackgroundJob(supabase, {
      organizationId,
      jobType: "webhook-processing",
      entityType: "webhook_endpoint",
      entityId: endpoint.id,
      progress: { event },
    });
  }
}

export function signWebhook(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}
