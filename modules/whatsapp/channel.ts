import type { SupabaseClient } from "@supabase/supabase-js";

export function isWatiConnectionActive(status?: string | null) {
  return (status ?? "").toUpperCase() === "CONNECTED";
}

export async function isOrgWatiConnected(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("wati_connections")
    .select("status")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return isWatiConnectionActive(data?.status);
}
