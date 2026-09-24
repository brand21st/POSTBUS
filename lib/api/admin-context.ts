import { matchesPlatformAdminEmail } from "@/lib/admin/access";
import { createServerSupabase } from "@/lib/supabase/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";

export type AdminContext = {
  userId: string;
  email: string | null;
};

export async function requirePlatformAdmin(): Promise<AdminContext> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Please sign in to continue.");
  }

  const email = (user.email ?? "").trim().toLowerCase();
  const { data: existing } = await supabase
    .from("platform_admins")
    .select("id, user_id, email")
    .or(`user_id.eq.${user.id}${email ? `,email.eq.${email}` : ""}`)
    .maybeSingle();

  if (!existing) {
    if (!matchesPlatformAdminEmail(email, env.platformAdminEmail) || !hasAdminClient()) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "Super Admin access required.");
    }
    await createAdminClient().from("platform_admins").upsert(
      { user_id: user.id, email },
      { onConflict: "email" }
    );
  } else if (!existing.user_id && hasAdminClient()) {
    await createAdminClient().from("platform_admins").update({ user_id: user.id }).eq("id", existing.id);
  }

  return { userId: user.id, email: user.email ?? null };
}
