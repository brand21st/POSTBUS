import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import {
  DEFAULT_AFTER_AUTH,
  PRODUCTION_APP_ORIGIN,
  requestPublicOrigin,
  safeAuthNext,
} from "@/lib/auth/urls";

const OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function loginError(origin: string, code: string) {
  const failure = new URL("/login", origin);
  failure.searchParams.set("error", code);
  return NextResponse.redirect(failure);
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = requestPublicOrigin(request).includes("postbus.in")
    ? PRODUCTION_APP_ORIGIN
    : requestPublicOrigin(request);
  const next = safeAuthNext(url.searchParams.get("next") || DEFAULT_AFTER_AUTH);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  const otpType = OTP_TYPES.has(rawType as EmailOtpType) ? (rawType as EmailOtpType) : "signup";

  if (url.searchParams.get("error")) {
    return loginError(origin, "auth_callback_failed");
  }

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return loginError(origin, "auth_callback_failed");
  }

  if (!code && !tokenHash) {
    return loginError(origin, "auth_callback_missing");
  }

  const redirect = NextResponse.redirect(new URL(next || DEFAULT_AFTER_AUTH, origin));
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          const cookieOptions = {
            ...options,
            path: options?.path ?? "/",
            sameSite: (options?.sameSite ?? "lax") as "lax" | "strict" | "none",
            secure: origin.startsWith("https://") ? true : options?.secure,
            ...(origin.includes("postbus.in") ? { domain: ".postbus.in" } : {}),
          };
          request.cookies.set(name, value);
          redirect.cookies.set(name, value, cookieOptions);
        });
      },
    },
  });

  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ type: otpType, token_hash: tokenHash as string });

  if (result.error) {
    return loginError(origin, "auth_callback_failed");
  }

  return redirect;
}
