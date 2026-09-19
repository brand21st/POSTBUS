import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const failure = new URL("/login", url.origin);
      failure.searchParams.set("error", "auth_callback_failed");
      return NextResponse.redirect(failure);
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
