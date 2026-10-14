import { cache } from "react";
import { cookies } from "next/headers";
import { classifyAuthSession, type AuthSessionClass } from "@/lib/auth/session/classify";
import { requestHasAuthCookie } from "@/lib/supabase/auth-cookies";
import { createServerSupabase } from "@/lib/supabase/server";

export const getRequestAuthUser = cache(async () => {
  const supabase = await createServerSupabase();
  const cookieStore = await cookies();
  const hasAuthCookie = requestHasAuthCookie(cookieStore.getAll());
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  const classification: AuthSessionClass = classifyAuthSession({
    user,
    error,
    hasAuthCookie,
  });
  return { supabase, user, error, classification, hasAuthCookie };
});
