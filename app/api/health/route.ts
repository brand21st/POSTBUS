import { NextResponse } from "next/server";
import { getSystemHealth } from "@/lib/api/health";
import { getBuildInfo } from "@/lib/build-info";

export async function GET() {
  return NextResponse.json({
    success: true,
    data: { ...(await getSystemHealth()), build: getBuildInfo() },
  });
}
