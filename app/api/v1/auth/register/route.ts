import { NextRequest } from "next/server";
import { registerAccountSchema } from "@/lib/auth/register-schema";
import { authCallbackUrl } from "@/lib/auth/urls";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/response";
import { rateLimit } from "@/lib/security/rate-limit";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") ?? "local";
    const limited = rateLimit(`${ip}:auth/register`, 8, 60_000);
    if (!limited.ok) {
      throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
    }

    const body = await request.json().catch(() => null);
    const values = registerAccountSchema.parse(body ?? {});
    const supabase = await createServerSupabase();

    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: {
          full_name: values.name,
          whatsapp_number: values.whatsapp,
        },
        emailRedirectTo: authCallbackUrl("/dashboard"),
      },
    });

    if (error) {
      const alreadyRegistered = /already|registered|exists/i.test(error.message);
      throw new AppError(
        alreadyRegistered ? ERROR_CODES.CONFLICT : ERROR_CODES.VALIDATION_ERROR,
        alreadyRegistered ? "An account with this email already exists." : error.message
      );
    }

    if (data.user?.id && data.session) {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: values.name,
          whatsapp_number: values.whatsapp,
        })
        .eq("id", data.user.id);
      if (profileError) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, profileError.message);
      }
    }

    return ok(
      {
        userId: data.user?.id ?? null,
        needsEmailConfirmation: !data.session,
        whatsappNumber: values.whatsapp,
      },
      data.session
        ? "Account created."
        : "Check your email and click the confirmation link. After it is verified you will land on your dashboard."
    );
  } catch (error) {
    return fail(error);
  }
}
