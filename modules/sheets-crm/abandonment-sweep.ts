import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyCustomer, lifecycleChanged } from "@/modules/sheets-crm/abandonment";
import { loadSheetsCrmConfig, sheetsCrmReady } from "@/modules/sheets-crm/config";
import { enqueueSheetsCrmEvent } from "@/modules/sheets-crm/enqueue";
import type { SheetsCrmLifecycle } from "@/modules/sheets-crm/events";
import { loadCrmSnapshot, loadStoredProjection } from "@/modules/sheets-crm/projection";
import { logError } from "@/lib/logger";

export async function sweepSheetsCrmAbandonment(supabase: SupabaseClient) {
  const config = await loadSheetsCrmConfig(supabase);
  if (!sheetsCrmReady(config)) return { checked: 0, queued: 0 };
  let query = supabase.from("profiles").select("id, created_at").order("created_at", { ascending: true }).limit(100);
  if (config.abandonCursor) query = query.gt("created_at", config.abandonCursor);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const page = data ?? [];
  let queued = 0;
  for (const profile of page) {
    queued += await enqueueIfLifecycleChanged(supabase, profile.id, config.thresholds);
  }
  const nextCursor = page.length < 100 ? null : page[page.length - 1]?.created_at ?? null;
  await supabase.from("platform_settings").update({ sheets_crm_abandon_cursor: nextCursor }).eq("id", 1);

  const { data: abandoned, error: abandonedError } = await supabase
    .from("sheets_crm_projections")
    .select("customer_id")
    .eq("lifecycle", "abandoned")
    .limit(100);
  if (abandonedError) throw new Error(abandonedError.message);
  for (const row of abandoned ?? []) {
    queued += await enqueueIfLifecycleChanged(supabase, row.customer_id, config.thresholds);
  }
  return { checked: page.length + (abandoned?.length ?? 0), queued };
}

async function enqueueIfLifecycleChanged(
  supabase: SupabaseClient,
  customerId: string,
  thresholds: Awaited<ReturnType<typeof loadSheetsCrmConfig>>["thresholds"]
) {
  try {
    const snapshot = await loadCrmSnapshot(supabase, customerId);
    if (!snapshot) return 0;
    const stored = await loadStoredProjection(supabase, customerId);
    const next = classifyCustomer(snapshot, thresholds, Date.now(), (stored?.lifecycle as SheetsCrmLifecycle | null) ?? null);
    if (!lifecycleChanged(stored?.lifecycle ?? null, next)) return 0;
    await enqueueSheetsCrmEvent(supabase, {
      eventType: next.lifecycle === "abandoned" ? "customer.abandoned" : "customer.reactivated",
      customerId,
      organizationId: snapshot.workspaces[0]?.id ?? null,
    });
    return 1;
  } catch (error) {
    logError("sheets_crm.abandon_check_failed", {
      message: error instanceof Error ? error.message : "check failed",
    });
    return 0;
  }
}
