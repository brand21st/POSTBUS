import type { SupabaseClient } from "@supabase/supabase-js";
import { writeBillingAudit } from "@/modules/billing/audit";
import { upsertAddonEntitlement } from "@/modules/addons/entitlements";

export async function runAddonBillingSweep(supabase: SupabaseClient) {
  const now = new Date().toISOString();
  const { data: expiring } = await supabase
    .from("organization_addon_subscriptions")
    .select("*")
    .in("status", ["ACTIVE", "CANCELLED", "PAYMENT_FAILED"])
    .lte("current_period_end", now);

  let expired = 0;
  for (const row of expiring ?? []) {
    await supabase
      .from("organization_addon_subscriptions")
      .update({ status: "EXPIRED", updated_at: now })
      .eq("id", row.id);
    await upsertAddonEntitlement(supabase, {
      organizationId: row.organization_id,
      slug: row.addon_slug,
      status: "EXPIRED",
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      sourceSubscriptionId: row.id,
    });
    await writeBillingAudit(supabase, {
      actorType: "SYSTEM",
      action: "addon.expired",
      targetType: "addon_subscription",
      targetId: row.id,
      organizationId: row.organization_id,
      metadata: { slug: row.addon_slug },
    });
    expired += 1;
  }
  return { expired };
}
