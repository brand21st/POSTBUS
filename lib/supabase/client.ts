import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import {
  authStorageKeyFromSupabaseUrl,
  expireLegacyDomainCookiesInBrowser,
  supabaseAuthCookieOptions,
} from "@/lib/supabase/auth-cookies";

export function createClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase public credentials are not configured.");
  }

  expireLegacyDomainCookiesInBrowser(authStorageKeyFromSupabaseUrl(env.supabaseUrl));

  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions: supabaseAuthCookieOptions({
      secure: typeof window !== "undefined" && window.location.protocol === "https:",
    }),
  });
}
