import type { SupabaseClient } from "@supabase/supabase-js";

export async function writeBillingAudit(
  supabase: SupabaseClient,
  input: {
    actorId?: string | null;
    actorType?: "SUPER_ADMIN" | "USER" | "SYSTEM" | "WEBHOOK";
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    organizationId?: string | null;
    ip?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await supabase.from("billing_audit_logs").insert({
    actor_id: input.actorId ?? null,
    actor_type: input.actorType ?? "SYSTEM",
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    organization_id: input.organizationId ?? null,
    ip: input.ip ?? null,
    metadata: input.metadata ?? {},
  });
}

export async function writeSubscriptionHistory(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    subscriptionId: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    fromPlanId?: string | null;
    toPlanId?: string | null;
    reason?: string | null;
    actor?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await supabase.from("subscription_history").insert({
    organization_id: input.organizationId,
    subscription_id: input.subscriptionId,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    from_plan_id: input.fromPlanId ?? null,
    to_plan_id: input.toPlanId ?? null,
    reason: input.reason ?? null,
    actor: input.actor ?? "SYSTEM",
    metadata: input.metadata ?? {},
  });
}
