import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { getPlatformVachatConfig, isPlatformVachatActive } from "@/modules/vachat/platform-config";
import { upsertVachatNotificationLog } from "@/modules/vachat/logs";
import { sendVachatPlatformTemplate, vachatRecipientE164 } from "@/modules/vachat/send";

export const SIGNUP_WELCOME_EVENT = "signup_welcome";

export function signupWelcomeExternalRef(userId: string) {
  return `postbus:signup_welcome:${userId}`;
}

export type SignupWelcomeJobProgress = {
  kind: "signup_welcome";
  userId: string;
  to: string;
  templateName: string;
  language: string;
  variables: string[];
};

function bodyName(fullName?: string | null) {
  const name = fullName?.trim();
  return name || "there";
}

export async function enqueueSignupWelcome(userId: string, organizationId: string) {
  try {
    if (!userId || !organizationId || !hasAdminClient()) return { queued: false as const };
    const platform = await getPlatformVachatConfig();
    const templateName = platform.signupWelcomeTemplateName.trim();
    if (!isPlatformVachatActive(platform) || !platform.signupWelcomeEnabled || !templateName) {
      logInfo("vachat.signup_welcome.skipped", {
        reason: !isPlatformVachatActive(platform) ? "platform_inactive" : "template_unset",
      });
      return { queued: false as const };
    }

    const supabase = createAdminClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("whatsapp_number, full_name, signup_welcome_sent_at")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.signup_welcome_sent_at) return { queued: false as const, reason: "already_sent" as const };

    const phoneRaw = profile?.whatsapp_number?.trim() || "";
    if (!phoneRaw) {
      logInfo("vachat.signup_welcome.skipped", { reason: "missing_phone", userId });
      return { queued: false as const, reason: "missing_phone" as const };
    }

    let to: string;
    try {
      to = vachatRecipientE164(phoneRaw);
    } catch {
      logInfo("vachat.signup_welcome.skipped", { reason: "invalid_phone", userId });
      return { queued: false as const, reason: "invalid_phone" as const };
    }

    const externalRef = signupWelcomeExternalRef(userId);
    const { data: existing } = await supabase
      .from("vachat_notification_logs")
      .select("id, status")
      .eq("organization_id", organizationId)
      .eq("external_ref", externalRef)
      .maybeSingle();
    if (existing && (existing.status === "sent" || existing.status === "queued")) {
      return { queued: false as const, reason: "already_logged" as const };
    }

    await upsertVachatNotificationLog(supabase, {
      organizationId,
      event: SIGNUP_WELCOME_EVENT,
      phone: to,
      externalRef,
      status: "queued",
    });

    const { createBackgroundJob } = await import("@/modules/jobs/service");
    const progress: SignupWelcomeJobProgress = {
      kind: "signup_welcome",
      userId,
      to,
      templateName,
      language: platform.signupWelcomeTemplateLanguage,
      variables: [bodyName(profile?.full_name)],
    };
    await createBackgroundJob(supabase, {
      organizationId,
      jobType: "vachat-notify",
      entityType: "profile",
      entityId: userId,
      userId,
      progress,
    });
    return { queued: true as const };
  } catch (error) {
    logError("vachat.signup_welcome.enqueue_failed", {
      userId,
      organizationId,
      message: error instanceof Error ? error.message : "enqueue",
    });
    return { queued: false as const };
  }
}

export async function deliverSignupWelcome(
  supabase: SupabaseClient,
  organizationId: string,
  progress: {
    userId?: string;
    to?: string;
    templateName?: string;
    language?: string;
    variables?: string[];
  }
) {
  const userId = progress.userId?.trim() || "";
  const to = progress.to?.trim() || "";
  const templateName = progress.templateName?.trim() || "";
  if (!userId || !to || !templateName) {
    throw Object.assign(new Error("Signup welcome job is missing user, phone, or template."), {
      code: "VALIDATION_ERROR",
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("signup_welcome_sent_at")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.signup_welcome_sent_at) return { sent: false as const, reason: "already_sent" as const };

  const externalRef = signupWelcomeExternalRef(userId);
  try {
    const result = await sendVachatPlatformTemplate({
      to,
      templateName,
      language: progress.language,
      bodyParams: progress.variables?.length ? progress.variables : ["there"],
    });
    await supabase
      .from("profiles")
      .update({ signup_welcome_sent_at: new Date().toISOString() })
      .eq("id", userId);
    await upsertVachatNotificationLog(supabase, {
      organizationId,
      event: SIGNUP_WELCOME_EVENT,
      phone: to,
      externalRef,
      status: "sent",
      vachatMessageId: result.messageId,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "send_failed";
    await upsertVachatNotificationLog(supabase, {
      organizationId,
      event: SIGNUP_WELCOME_EVENT,
      phone: to,
      externalRef,
      status: "failed",
      error: message.slice(0, 240),
    });
    throw error;
  }
}
