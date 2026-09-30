import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret } from "@/lib/security/crypto";

export async function persistIndiaPostTokens(
  supabase: SupabaseClient,
  connection: { id: string },
  tokens: {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
    refresh_expires_in: number;
  }
) {
  await supabase
    .from("india_post_connections")
    .update({
      encrypted_access_token: encryptSecret(tokens.access_token),
      encrypted_refresh_token: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      encrypted_id_token: tokens.id_token ? encryptSecret(tokens.id_token) : null,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(Date.now() + tokens.refresh_expires_in * 1000).toISOString(),
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("id", connection.id);
}
