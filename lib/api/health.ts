import type { SupabaseClient } from "@supabase/supabase-js";
import { env, isShopifyAppConfigured } from "@/lib/env";
import { redisHealth } from "@/lib/queue/connection";

export type SystemHealth = {
  api: "Healthy";
  database: "Healthy" | "Error";
  redis: "Healthy" | "Warning";
  shopify: "Healthy" | "Warning";
  indiaPost: "Healthy" | "Warning" | "Error";
};

async function databaseFromAuthEndpoint(): Promise<"Healthy" | "Error"> {
  try {
    if (!env.supabaseUrl) return "Error";
    const response = await fetch(`${env.supabaseUrl}/auth/v1/health`);
    return response.ok ? "Healthy" : "Error";
  } catch {
    return "Error";
  }
}

export async function getSystemHealth(supabase?: SupabaseClient): Promise<SystemHealth> {
  let database: "Healthy" | "Error" = "Error";
  if (supabase) {
    const { error } = await supabase.from("billing_plans").select("id").limit(1);
    database = error ? "Error" : "Healthy";
  } else {
    database = await databaseFromAuthEndpoint();
  }

  return {
    api: "Healthy",
    database,
    redis: (await redisHealth()) ? "Healthy" : "Warning",
    shopify: isShopifyAppConfigured() ? "Healthy" : "Warning",
    indiaPost: env.indiaPostUatBaseUrl || env.indiaPostProdBaseUrl ? "Warning" : "Error",
  };
}
