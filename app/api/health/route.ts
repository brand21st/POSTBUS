import { NextResponse } from "next/server";
import { env, isShopifyAppConfigured } from "@/lib/env";
import { redisHealth } from "@/lib/queue/connection";

export async function GET() {
  let database: "Healthy" | "Error" = "Error";
  try {
    if (env.supabaseUrl) {
      const response = await fetch(`${env.supabaseUrl}/auth/v1/health`);
      database = response.ok ? "Healthy" : "Error";
    }
  } catch {
    database = "Error";
  }

  return NextResponse.json({
    success: true,
    data: {
      api: "Healthy",
      database,
      redis: (await redisHealth()) ? "Healthy" : "Warning",
      shopify: isShopifyAppConfigured() ? "Healthy" : "Warning",
      indiaPost: env.indiaPostUatBaseUrl || env.indiaPostProdBaseUrl ? "Warning" : "Error",
    },
  });
}
