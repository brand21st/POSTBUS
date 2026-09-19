import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { parseTrackingSubdomain } from "@/modules/tracking-pages/host";

function shouldRewriteToTrack(pathname: string) {
  return (
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next/") &&
    pathname !== "/track" &&
    !pathname.startsWith("/track/")
  );
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const subdomain = parseTrackingSubdomain(host);
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
