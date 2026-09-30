import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";

export const getRequestAuthUser = cache(async () => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
});
