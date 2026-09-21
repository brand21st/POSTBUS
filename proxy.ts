import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { parseTrackingSubdomain } from "@/modules/tracking-pages/host";

function requestHostname(hostHeader: string | null) {
  return hostHeader?.split(":")[0]?.toLowerCase() ?? "";
}

function shouldRewriteToTrack(pathname: string) {
  return (
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next/") &&
    pathname !== "/track" &&
    !pathname.startsWith("/track/")
  );
}

export async function proxy(request: NextRequest) {
  const hostHeader = request.headers.get("host");
  const canonicalHost = requestHostname(hostHeader) || request.nextUrl.hostname.toLowerCase();
  // Keep auth cookies on one host so confirmation links do not lose the session.
  if (canonicalHost === "postbus.in") {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.hostname = "www.postbus.in";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  const subdomain = parseTrackingSubdomain(hostHeader);
  const extraHeaders = new Headers(request.headers);

  if (subdomain) {
    extraHeaders.set("x-tracking-subdomain", subdomain);
    if (shouldRewriteToTrack(request.nextUrl.pathname)) {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = "/track";
      return updateSession(request, { extraHeaders, rewriteUrl });
    }
    return updateSession(request, { extraHeaders });
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|src/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
