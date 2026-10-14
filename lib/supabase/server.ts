import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { supabaseAuthCookieOptions } from "@/lib/supabase/auth-cookies";

async function createServerSupabaseUncached() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase public credentials are not configured.");
  }

  const cookieStore = await cookies();
  const cookieOptions = supabaseAuthCookieOptions({ secure: true });

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — session refresh happens in proxy.
        }
      },
    },
  });
}

// One SSR client per incoming request. Do not reuse across users or requests.
export const createServerSupabase = cache(createServerSupabaseUncached);
