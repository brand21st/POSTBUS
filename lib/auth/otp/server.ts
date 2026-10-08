import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { createWhatsappAuthUser, linkPhoneIdentity, resolvePhoneIdentity } from "@/lib/auth/identity/phone";
import { isWhatsappOtpEnabled } from "@/lib/auth/otp/flags";
import { OTP_MESSAGES } from "@/lib/auth/otp/policy";
import { otpPepper } from "@/lib/auth/otp/secrets";
import { sendWhatsappOtp } from "@/lib/auth/otp/send-whatsapp";
import { requestOtp, verifyOtp, type OtpDeps, type OtpRequestInput } from "@/lib/auth/otp/service";
import { createSupabaseOtpStore } from "@/lib/auth/otp/supabase-store";
import { mintMagicLinkSession } from "@/lib/auth/session/mint";
import { ensureActiveWorkspace } from "@/modules/organizations/service";
import { createAdminClient } from "@/lib/supabase/admin";

function deps(): OtpDeps {
  if (!isWhatsappOtpEnabled()) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, OTP_MESSAGES.unavailable);
  }
  const pepper = otpPepper();
  if (pepper.length < 16) {
    logError("otp.misconfigured", { reason: "pepper" });
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, OTP_MESSAGES.sendFailed);
  }
  const admin = createAdminClient();
  return {
    now: () => Date.now(),
    pepper,
    store: createSupabaseOtpStore(admin),
    send: sendWhatsappOtp,
    resolveIdentity: (phone) => resolvePhoneIdentity(admin, phone),
    createUser: async (input) => {
      try {
        return await createWhatsappAuthUser(admin, {
          email: input.email,
          phoneE164: input.phone,
          fullName: input.name,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "EMAIL_TAKEN") throw error;
        throw new Error("CREATE_FAILED");
      }
    },
    linkIdentity: (phone, userId) => linkPhoneIdentity(admin, phone, userId),
    mint: async (email) => {
      const session = await mintMagicLinkSession(email);
      return { userId: session.userId, session: session.supabase };
    },
    ensureWorkspace: async (input) => {
      try {
        await ensureActiveWorkspace(input.session as SupabaseClient, input.userId, {
          workspaceName: input.workspaceName,
          fullName: input.fullName,
          email: input.email,
        });
      } catch (error) {
        logError("otp.workspace_failed", {
          message: error instanceof Error ? error.message : "workspace",
        });
      }
    },
  };
}

export async function requestWhatsappOtp(input: OtpRequestInput) {
  return requestOtp(deps(), input);
}

export async function verifyWhatsappOtp(
  input: Parameters<typeof verifyOtp>[1]
) {
  return verifyOtp(deps(), input);
}
