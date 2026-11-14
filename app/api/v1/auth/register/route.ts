import { NextRequest } from "next/server";
import { bindSignupReferral } from "@/modules/affiliates/service";
import { scheduleSheetsCrmEvent } from "@/modules/sheets-crm/enqueue";
import { registerAccountSchema } from "@/lib/auth/register-schema";
import { authCallbackUrl } from "@/lib/auth/urls";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/response";
import { logError } from "@/lib/logger";
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
          pincode: values.pincode,
          city: values.city,
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

    // With email confirmation on, Supabase hides an existing confirmed account: no error, no
    // session, and a placeholder user with zero identities. No email goes out, so say so here
    // instead of telling the merchant to wait for a confirmation that will never arrive.
    if (data.user && !data.session && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        "An account with this email already exists. Sign in or reset your password."
      );
    }

    if (data.user?.id) {
      await bindSignupReferral(data.user.id);
      scheduleSheetsCrmEvent({ eventType: "customer.signup.completed", customerId: data.user.id });
    }
    if (data.user?.id && !data.session) {
      void import("@/modules/vachat/abandoned-signup")
        .then(({ enqueueAbandonedSignup }) => enqueueAbandonedSignup(data.user!.id))
        .catch((scheduleError) => {
          logError("vachat.abandoned_signup.schedule_failed", {
            userId: data.user?.id,
            message: scheduleError instanceof Error ? scheduleError.message : "schedule",
          });
        });
    }
    if (data.user?.id && data.session) {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: values.name,
          whatsapp_number: values.whatsapp,
          pincode: values.pincode,
          city: values.city,
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
