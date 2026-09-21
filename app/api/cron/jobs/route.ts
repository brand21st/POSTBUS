import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { authorizeCron } from "@/lib/jobs/cron-auth";
import { DEFAULT_DRAIN_LIMIT, drainDueJobs } from "@/lib/jobs/drain";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = authorizeCron(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ success: false, message: auth.reason }, { status: 401 });
  }

  if (env.jobRunner !== "database") {
    return NextResponse.json(
      {
        success: false,
        message: "JOB_RUNNER is set to redis, so BullMQ workers own the queue.",
      },
      { status: 409 }
    );
  }

  const requested = Number(request.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(requested) && requested > 0 ? Math.min(Math.trunc(requested), 25) : DEFAULT_DRAIN_LIMIT;

  try {
    return NextResponse.json({ success: true, data: await drainDueJobs(limit) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not drain background jobs.";
    logError("jobs.drain_error", { message });
    // The endpoint is gated by CRON_SECRET, so the operator running it gets the reason.
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
