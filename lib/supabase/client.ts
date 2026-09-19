import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

export function createClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase public credentials are not configured.");
  }

  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
