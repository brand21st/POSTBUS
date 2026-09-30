import type { SupabaseClient } from "@supabase/supabase-js";

export type ReadyIndiaPostLabel = {
  id: string;
  file_path: string | null;
  file_url: string | null;
  status: string | null;
};

export async function findReadyIndiaPostLabel(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string
): Promise<ReadyIndiaPostLabel | null> {
  const { data } = await supabase
    .from("labels")
    .select("id, file_path, file_url, status")
    .eq("organization_id", organizationId)
    .eq("shipment_id", shipmentId)
    .eq("kind", "INDIA_POST")
    .eq("status", "READY")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.id) return null;
  if (!data.file_path && !data.file_url) return null;
  return data as ReadyIndiaPostLabel;
}
