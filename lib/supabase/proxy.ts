import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  hasPlatformAdminRow,
  matchesPlatformAdminEmail,
  signedInHomePath,
} from "@/lib/admin/access";
import { env } from "@/lib/env";

const AUTH_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];

type SessionOptions = {
  extraHeaders?: Headers;
  rewriteUrl?: URL;
};

export async function updateSession(request: NextRequest, options?: SessionOptions) {
  const requestHeaders = options?.extraHeaders ?? request.headers;
  const nextResponse = () =>
    options?.rewriteUrl
      ? NextResponse.rewrite(options.rewriteUrl, { request: { headers: requestHeaders } })
      : NextResponse.next({ request: { headers: requestHeaders } });
  let supabaseResponse = nextResponse();

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = nextResponse();
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isDashboard = pathname.startsWith("/dashboard");
  const isAdmin = pathname.startsWith("/admin");
  const isOnboarding = pathname.startsWith("/onboarding");
  const isAuthPage = AUTH_PATHS.some((path) => pathname.startsWith(path));
  const isTrackingHost = Boolean(requestHeaders.get("x-tracking-subdomain"));

  if (!user && (isDashboard || isAdmin || isOnboarding) && !isTrackingHost) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (isAuthPage || isDashboard) && !isTrackingHost) {
    const email = (user.email ?? "").trim().toLowerCase();
    const isPlatformAdmin =
      matchesPlatformAdminEmail(email, env.platformAdminEmail) ||
      (await hasPlatformAdminRow(supabase, user.id, email));
    if (isAuthPage || (isDashboard && isPlatformAdmin)) {
      const url = request.nextUrl.clone();
      url.pathname = signedInHomePath(isPlatformAdmin);
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
