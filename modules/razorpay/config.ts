import { env } from "@/lib/env";
import { logError } from "@/lib/logger";
import { decryptSecret } from "@/lib/security/crypto";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";

export const RAZORPAY_BILLING_WEBHOOK_EVENTS = [
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.updated",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.paused",
  "subscription.resumed",
  "subscription.completed",
  "payment.captured",
  "payment.failed",
  "invoice.paid",
  "refund.processed",
] as const;

export type RazorpayConfig = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  webhookId: string | null;
  source: "database" | "env" | "mixed" | "none";
  mode: "live" | "test";
};

type SettingsRow = {
  razorpay_key_id?: string | null;
  encrypted_razorpay_key_secret?: string | null;
  encrypted_razorpay_webhook_secret?: string | null;
  razorpay_webhook_id?: string | null;
};

function decryptOptional(payload?: string | null) {
  if (!payload) return "";
  try {
    return decryptSecret(payload);
  } catch (error) {
    logError("razorpay.decrypt_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return "";
  }
}

export function razorpayMode(keyId: string): "live" | "test" {
  return keyId.startsWith("rzp_live") ? "live" : "test";
}

export function billingWebhookEventsPayload() {
  return Object.fromEntries(RAZORPAY_BILLING_WEBHOOK_EVENTS.map((event) => [event, true]));
}

export function razorpayWebhookUrl() {
  return `${env.appUrl.replace(/\/$/, "")}/api/webhooks/razorpay`;
}

async function loadSettingsRow(): Promise<SettingsRow | null> {
  if (!hasAdminClient()) return null;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("platform_settings")
    .select(
      "razorpay_key_id, encrypted_razorpay_key_secret, encrypted_razorpay_webhook_secret, razorpay_webhook_id"
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    logError("razorpay.settings_load_failed", { message: error.message });
    return null;
  }
  return data;
}

export async function getRazorpayConfig(): Promise<RazorpayConfig> {
  const row = await loadSettingsRow();
  const dbKeyId = row?.razorpay_key_id?.trim() || "";
  const dbSecret = decryptOptional(row?.encrypted_razorpay_key_secret);
  const dbWebhook = decryptOptional(row?.encrypted_razorpay_webhook_secret);
  const envKeyId = env.razorpayPublicKeyId || env.razorpayKeyId;
  const keyId = dbKeyId || envKeyId;
  const keySecret = dbSecret || env.razorpayKeySecret;
  const webhookSecret = dbWebhook || env.razorpayWebhookSecret;
  const hasDb = Boolean(dbKeyId || dbSecret || dbWebhook);
  const hasEnv = Boolean(env.razorpayKeyId || env.razorpayKeySecret || env.razorpayWebhookSecret || env.razorpayPublicKeyId);
  const source: RazorpayConfig["source"] = !keyId && !keySecret && !webhookSecret
    ? "none"
    : hasDb && hasEnv && (!dbKeyId || !dbSecret)
      ? "mixed"
      : hasDb
        ? "database"
        : "env";
  return {
    keyId,
    keySecret,
    webhookSecret,
    webhookId: row?.razorpay_webhook_id?.trim() || null,
    source,
    mode: razorpayMode(keyId),
  };
}

export async function getRazorpayCredentials() {
  const config = await getRazorpayConfig();
  return { keyId: config.keyId, secret: config.keySecret };
}

export async function getRazorpayWebhookSecret() {
  const config = await getRazorpayConfig();
  return config.webhookSecret;
}

export async function isBillingConfiguredAsync() {
  const config = await getRazorpayConfig();
  return Boolean(config.keyId && config.keySecret);
}

export function publicRazorpayStatus(config: RazorpayConfig) {
  return {
    connected: Boolean(config.keyId && config.keySecret),
    keyId: config.keyId,
    keyIdMasked: config.keyId
      ? `${config.keyId.slice(0, 8)}••••${config.keyId.slice(-4)}`
      : "",
    keySecretConfigured: Boolean(config.keySecret),
    webhookSecretConfigured: Boolean(config.webhookSecret),
    webhookConfigured: Boolean(config.webhookSecret),
    webhookId: config.webhookId,
    webhookUrl: razorpayWebhookUrl(),
    webhookEvents: [...RAZORPAY_BILLING_WEBHOOK_EVENTS],
    mode: config.mode,
    source: config.source,
  };
}
