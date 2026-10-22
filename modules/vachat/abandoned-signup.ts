import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { getPlatformVachatConfig, isPlatformVachatActive } from "@/modules/vachat/platform-config";
import { upsertVachatNotificationLog } from "@/modules/vachat/logs";
import { sendVachatPlatformTemplate, vachatRecipientE164 } from "@/modules/vachat/send";

export const ABANDONED_SIGNUP_EVENT = "abandoned_signup";
export const ABANDONED_SIGNUP_SWEEP_LIMIT = 25;

export function abandonedSignupExternalRef(userId: string) {
  return `postbus:abandoned_signup:${userId}`;
}

function bodyName(fullName?: string | null) {
  const name = fullName?.trim();
  return name || "there";
}

async function loadUnconfirmedUser(
  supabase: SupabaseClient,
  userId: string
): Promise<{ confirmed: boolean; missing: boolean }> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user) return { confirmed: false, missing: true };
  const confirmed = Boolean(data.user.email_confirmed_at || data.user.phone_confirmed_at);
  return { confirmed, missing: false };
}

export async function enqueueAbandonedSignup(userId: string) {
  try {
    if (!userId || !hasAdminClient()) return { queued: false as const };
    const platform = await getPlatformVachatConfig();
    const templateName = platform.abandonedSignupTemplateName.trim();
    if (!isPlatformVachatActive(platform) || !platform.abandonedSignupEnabled || !templateName) {
      logInfo("vachat.abandoned_signup.skipped", {
        reason: !isPlatformVachatActive(platform) ? "platform_inactive" : "template_unset",
      });
      return { queued: false as const };
    }

    const supabase = createAdminClient();
    return deliverAbandonedSignup(supabase, {
      userId,
      templateName,
      language: platform.abandonedSignupTemplateLanguage,
    });
  } catch (error) {
    logError("vachat.abandoned_signup.enqueue_failed", {
      userId,
      message: error instanceof Error ? error.message : "enqueue",
    });
    return { queued: false as const };
  }
}

export async function deliverAbandonedSignup(
  supabase: SupabaseClient,
  input: {
    userId: string;
    templateName?: string;
    language?: string;
    phone?: string | null;
    fullName?: string | null;
  }
) {
  const userId = input.userId.trim();
  if (!userId) return { queued: false as const };

  const { data: profile } = await supabase
    .from("profiles")
    .select("whatsapp_number, full_name, abandoned_signup_sent_at")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.abandoned_signup_sent_at) return { queued: false as const, reason: "already_sent" as const };

  const authState = await loadUnconfirmedUser(supabase, userId);
  if (authState.missing) return { queued: false as const, reason: "missing_user" as const };
  if (authState.confirmed) return { queued: false as const, reason: "already_confirmed" as const };

  const phoneRaw = input.phone?.trim() || profile?.whatsapp_number?.trim() || "";
  if (!phoneRaw) {
    logInfo("vachat.abandoned_signup.skipped", { reason: "missing_phone", userId });
    return { queued: false as const, reason: "missing_phone" as const };
  }

  let to: string;
  try {
    to = vachatRecipientE164(phoneRaw);
  } catch {
    logInfo("vachat.abandoned_signup.skipped", { reason: "invalid_phone", userId });
    return { queued: false as const, reason: "invalid_phone" as const };
  }

  const platform = await getPlatformVachatConfig();
  const templateName = (input.templateName || platform.abandonedSignupTemplateName).trim();
  if (!templateName) return { queued: false as const, reason: "template_unset" as const };

  const externalRef = abandonedSignupExternalRef(userId);
  const { data: existing } = await supabase
    .from("vachat_notification_logs")
    .select("id, status")
    .is("organization_id", null)
    .eq("external_ref", externalRef)
    .maybeSingle();
  if (existing && (existing.status === "sent" || existing.status === "queued")) {
    return { queued: false as const, reason: "already_logged" as const };
  }

  await upsertVachatNotificationLog(supabase, {
    event: ABANDONED_SIGNUP_EVENT,
    phone: to,
    externalRef,
    status: "queued",
  });

  try {
    const result = await sendVachatPlatformTemplate({
      to,
      templateName,
      language: input.language || platform.abandonedSignupTemplateLanguage,
      bodyParams: [bodyName(input.fullName ?? profile?.full_name)],
    });
    await supabase
      .from("profiles")
      .update({ abandoned_signup_sent_at: new Date().toISOString() })
      .eq("id", userId);
    await upsertVachatNotificationLog(supabase, {
      event: ABANDONED_SIGNUP_EVENT,
      phone: to,
      externalRef,
      status: "sent",
      vachatMessageId: result.messageId,
    });
    return { queued: true as const, sent: true as const, messageId: result.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "send_failed";
    await upsertVachatNotificationLog(supabase, {
      event: ABANDONED_SIGNUP_EVENT,
      phone: to,
      externalRef,
      status: "failed",
      error: message.slice(0, 240),
    });
    logError("vachat.abandoned_signup.send_failed", { userId, message });
    return { queued: false as const, reason: "send_failed" as const };
  }
}

export async function sweepAbandonedSignups(supabase: SupabaseClient, limit = ABANDONED_SIGNUP_SWEEP_LIMIT) {
  const cap = Math.max(1, Math.min(limit, ABANDONED_SIGNUP_SWEEP_LIMIT));
  const platform = await getPlatformVachatConfig();
  const templateName = platform.abandonedSignupTemplateName.trim();
  if (!isPlatformVachatActive(platform) || !platform.abandonedSignupEnabled || !templateName) {
    return { considered: 0, sent: 0 };
  }

  const { data: rows } = await supabase
    .from("admin_abandoned_signups")
    .select("id, full_name, whatsapp_number")
    .not("whatsapp_number", "is", null)
    .order("created_at", { ascending: true })
    .limit(80);

  const candidates = (rows ?? []).filter((row) => row.whatsapp_number?.trim());
  const ids = candidates.map((row) => row.id);
  const sent = new Set<string>();
  if (ids.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, abandoned_signup_sent_at")
      .in("id", ids);
    for (const profile of profiles ?? []) {
      if (profile.abandoned_signup_sent_at) sent.add(profile.id);
    }
  }

  let sentCount = 0;
  let considered = 0;
  for (const row of candidates) {
    if (sent.has(row.id)) continue;
    considered += 1;
    const result = await deliverAbandonedSignup(supabase, {
      userId: row.id,
      templateName,
      language: platform.abandonedSignupTemplateLanguage,
      phone: row.whatsapp_number,
      fullName: row.full_name,
    });
    if (result.queued) sentCount += 1;
    if (considered >= cap) break;
  }
  return { considered, sent: sentCount };
}
