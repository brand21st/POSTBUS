import { NextResponse } from "next/server";
import { env, isShopifyAppConfigured } from "@/lib/env";
import { PRODUCTION_SUPABASE_REF } from "@/lib/env/staging-isolation";

function hostOf(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

/** Staging-only, non-secret identity. 404 outside POSTBUS_ENV=staging. */
export async function GET() {
  const mode = (process.env.POSTBUS_ENV || "").trim().toLowerCase();
  if (mode !== "staging") {
    return NextResponse.json({ error: "runtime identity is staging-only" }, { status: 404 });
  }

  const supabaseHost = hostOf(env.supabaseUrl);
  const productionSupabaseDetected =
    env.supabaseUrl.toLowerCase().includes(PRODUCTION_SUPABASE_REF) ||
    (process.env.DATABASE_URL || "").toLowerCase().includes(PRODUCTION_SUPABASE_REF);

  return NextResponse.json({
    success: true,
    data: {
      postbusEnv: mode,
      appHost: hostOf(env.appUrl),
      supabaseHost,
      indiaPostUatHost: hostOf(env.indiaPostUatBaseUrl),
      indiaPostProdHost: hostOf(env.indiaPostProdBaseUrl),
      shopifyConfigured: isShopifyAppConfigured(),
      razorpayConfigured: Boolean(env.razorpayKeyId),
      jobRunner: env.jobRunner,
      productionSupabaseDetected,
      supabaseAnonKeyPresent: Boolean(env.supabaseAnonKey),
      supabaseServiceRolePresent: Boolean(env.supabaseServiceRoleKey),
    },
  });
}
