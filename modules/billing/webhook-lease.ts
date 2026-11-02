import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcFunctionMissing } from "@/modules/billing/purchase";

export type WebhookClaim =
  | { state: "claimed"; id: string; lease: string | null }
  | { state: "complete" }
  | { state: "busy" }
  | { state: "missing" };

/**
 * Claim a stored Razorpay webhook event for processing. A failed or abandoned
 * attempt can be claimed again by Razorpay's retry; a live lease cannot be stolen;
 * processed and ignored events are never reprocessed.
 *
 * `fallbackId` is used only when the claim RPC is not deployed yet: the event row
 * was just inserted by this request, so it is processed once as before.
 */
export async function claimWebhookEvent(
  supabase: SupabaseClient,
  eventId: string,
  fallbackId?: string | null,
  leaseSeconds = 300
): Promise<WebhookClaim> {
  const { data, error } = await supabase.rpc("claim_razorpay_webhook_event", {
    p_event_id: eventId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    if (rpcFunctionMissing(error) && fallbackId) return { state: "claimed", id: fallbackId, lease: null };
    throw new Error("Webhook claim is unavailable.");
  }
  const row = (data ?? {}) as { state?: string; id?: string; lease?: string };
  if (row.state === "claimed" && row.id) return { state: "claimed", id: row.id, lease: row.lease ?? null };
  if (row.state === "complete") return { state: "complete" };
  if (row.state === "busy") return { state: "busy" };
  return { state: "missing" };
}

/** Finish a claimed event. With a lease, only the current holder can write the result. */
export async function finishWebhookEvent(
  supabase: SupabaseClient,
  claim: { id: string; lease: string | null },
  outcome: { status: "processed" | "ignored" } | { status: "failed"; error: string }
) {
  const patch: Record<string, unknown> =
    outcome.status === "failed"
      ? { status: "failed", error: outcome.error.slice(0, 500), processing_until: null }
      : { status: outcome.status, processed_at: new Date().toISOString(), error: null, processing_until: null };
  let query = supabase.from("razorpay_webhook_events").update(patch).eq("id", claim.id);
  if (claim.lease) query = query.eq("processing_lease", claim.lease);
  const { error } = await query;
  if (error && claim.lease) {
    // Columns from the lease migration may be missing on an older database.
    const legacy = { ...patch };
    delete legacy.processing_until;
    await supabase.from("razorpay_webhook_events").update(legacy).eq("id", claim.id);
  }
}
