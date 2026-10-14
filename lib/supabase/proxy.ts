import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  hasPlatformAdminRow,
  matchesPlatformAdminEmail,
  signedInHomePath,
} from "@/lib/admin/access";
import { classifyAuthSession, shouldRedirectToLogin } from "@/lib/auth/session/classify";
import { env } from "@/lib/env";
import { logInfo } from "@/lib/logger";
import {
  appendLegacyDomainExpiryHeaders,
  authStorageKeyFromSupabaseUrl,
  requestHasAuthCookie,
  supabaseAuthCookieOptions,
} from "@/lib/supabase/auth-cookies";

const AUTH_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];

type SessionOptions = {
  extraHeaders?: Headers;
  rewriteUrl?: URL;
};

function needsProxyGetUser(pathname: string) {
  return (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/onboarding") ||
    AUTH_PATHS.some((path) => pathname.startsWith(path))
  );
}

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

  const pathname = request.nextUrl.pathname;
  const isDashboard = pathname.startsWith("/dashboard");
  const isAdmin = pathname.startsWith("/admin");
  const isOnboarding = pathname.startsWith("/onboarding");
  const isAuthPage = AUTH_PATHS.some((path) => pathname.startsWith(path));
  const isTrackingHost = Boolean(requestHeaders.get("x-tracking-subdomain"));

  if (!needsProxyGetUser(pathname) || isTrackingHost) {
    return supabaseResponse;
  }

  const cookieOptions = supabaseAuthCookieOptions({ secure: true });
  const storageKey = authStorageKeyFromSupabaseUrl(env.supabaseUrl);

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = nextResponse();
        cookiesToSet.forEach(({ name, value, options: setOptions }) =>
          supabaseResponse.cookies.set(name, value, setOptions)
        );
        appendLegacyDomainExpiryHeaders(supabaseResponse.headers, storageKey, true);
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  const hasAuthCookie = requestHasAuthCookie(request.cookies.getAll());
  const classification = classifyAuthSession({ user, error, hasAuthCookie });

  if (error || classification !== "AUTH_VALID") {
    logInfo("auth.session_classified", {
      classification,
      code: error?.code ?? null,
      status: error?.status ?? null,
      path: pathname,
    });
  }

  function finish(response: NextResponse) {
    appendLegacyDomainExpiryHeaders(response.headers, storageKey, true);
    return response;
  }

  if (
    shouldRedirectToLogin(classification) &&
    (isDashboard || isAdmin || isOnboarding) &&
    !isTrackingHost
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie.name, cookie.value);
    });
    return finish(redirect);
  }

  if (user && classification === "AUTH_VALID" && (isAuthPage || isDashboard) && !isTrackingHost) {
    const email = (user.email ?? "").trim().toLowerCase();
    const isPlatformAdmin =
      matchesPlatformAdminEmail(email, env.platformAdminEmail) ||
      (await hasPlatformAdminRow(supabase, user.id, email));
    if (isAuthPage || (isDashboard && isPlatformAdmin)) {
      const url = request.nextUrl.clone();
      url.pathname = signedInHomePath(isPlatformAdmin);
      url.search = "";
      const redirect = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirect.cookies.set(cookie.name, cookie.value);
      });
      return finish(redirect);
    }
  }

  return finish(supabaseResponse);
}
