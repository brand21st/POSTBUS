import { NextRequest, NextResponse } from "next/server";
import { apiRouteWithContext } from "@/lib/api/handler";
import { rateLimit } from "@/lib/security/rate-limit";
import { resolvePrintAgentUpdate } from "@/modules/print-agent/updater";

type RouteParams = {
  target: string;
  arch: string;
  currentVersion: string;
};

export const GET = apiRouteWithContext<RouteParams>(async (request: NextRequest, context) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  const limited = rateLimit(`print-agent-updater:${ip}`, 120, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { target, arch, currentVersion } = await context.params;
  const update = resolvePrintAgentUpdate(target, arch, decodeURIComponent(currentVersion));
  if (!update) {
    return new Response(null, { status: 204 });
  }

  return NextResponse.json({
    version: update.version,
    notes: update.notes ?? "",
    pub_date: update.pubDate ?? new Date().toISOString(),
    url: update.url,
    signature: update.signature,
  });
});
