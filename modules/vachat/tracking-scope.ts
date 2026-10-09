import type { SupabaseClient } from "@supabase/supabase-js";
import { orderIdsForCustomerPhone } from "@/modules/vachat/knowledge";
import type { WhatsappSupportSession } from "@/modules/vachat/support-session";

export async function organizationIdsForTrackingAssistant(
  supabase: SupabaseClient,
  phoneDigits: string,
  session?: WhatsappSupportSession | null
) {
  if (session?.selected_organization_id) return [session.selected_organization_id];
  const { data: bind } = await supabase
    .from("support_global_binds")
    .select("organization_id, order_id, expires_at")
    .eq("phone_digits", phoneDigits)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!bind?.organization_id || !bind.order_id) return [];
  const ids = await orderIdsForCustomerPhone(supabase, bind.organization_id, `+91${phoneDigits}`);
  if (!ids.includes(String(bind.order_id))) return [];
  return [String(bind.organization_id)];
}
