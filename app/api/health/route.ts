import { NextResponse } from "next/server";
import { getSystemHealth } from "@/lib/api/health";

export async function GET() {
  return NextResponse.json({
    success: true,
    data: await getSystemHealth(),
  });
}
