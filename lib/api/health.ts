import type { SupabaseClient } from "@supabase/supabase-js";
import { env, isShopifyAppConfigured } from "@/lib/env";
import { redisHealth } from "@/lib/queue/connection";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";

export type SystemHealth = {
  api: "Healthy";
  database: "Healthy" | "Error";
  redis: "Healthy" | "Warning" | "Disabled";
  jobRunner: "database" | "redis";
  jobs: "Healthy" | "Warning" | "Unknown";
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

// Jobs that stay claimable well past their due time mean no runner is reaching
// the queue — the failure mode that left shipments stuck in QUEUED.
async function jobsHealth(): Promise<SystemHealth["jobs"]> {
  if (!hasAdminClient()) return "Unknown";
  try {
    const { data, error } = await createAdminClient().rpc("count_overdue_background_jobs");
    if (error) return "Unknown";
    return Number(data ?? 0) > 0 ? "Warning" : "Healthy";
  } catch {
    return "Unknown";
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

  const usesRedis = env.jobRunner === "redis";

  return {
    api: "Healthy",
    database,
    redis: usesRedis ? ((await redisHealth()) ? "Healthy" : "Warning") : "Disabled",
    jobRunner: env.jobRunner,
    jobs: await jobsHealth(),
    shopify: isShopifyAppConfigured() ? "Healthy" : "Warning",
    indiaPost: env.indiaPostUatBaseUrl || env.indiaPostProdBaseUrl ? "Warning" : "Error",
  };
}
