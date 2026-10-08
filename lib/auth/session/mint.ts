import { logError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export async function mintMagicLinkSession(email: string) {
  const admin = createAdminClient();
  let lastMessage = "session";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link.data?.properties?.hashed_token;
    if (link.error || !tokenHash) {
      lastMessage = link.error?.message || "link";
      continue;
    }
    const supabase = await createServerSupabase();
    const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (!verified.error && verified.data.user) {
      return { supabase, userId: verified.data.user.id, email: verified.data.user.email ?? email };
    }
    lastMessage = verified.error?.message || "verify";
  }
  logError("otp.mint_failed", { message: lastMessage });
  throw new Error("SESSION_FAILED");
}
