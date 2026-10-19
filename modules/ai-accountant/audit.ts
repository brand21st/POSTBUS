import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";

/** Best-effort accounting audit trail; never blocks the mutation it records. */
export async function writeAccountingAudit(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    actorId: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const { error } = await supabase.from("accounting_audit_logs").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) logError("ai_accountant.audit_failed", { action: input.action, message: error.message });
}
