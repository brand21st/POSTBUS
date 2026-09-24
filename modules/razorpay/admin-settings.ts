import type { NextRequest } from "next/server";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { AdminContext } from "@/lib/api/admin-context";
import { encryptSecret, randomToken } from "@/lib/security/crypto";
import { writeBillingAudit } from "@/modules/billing/audit";
import {
  createRazorpayWebhook,
  listRazorpayWebhooks,
  pingRazorpayApi,
  updateRazorpayWebhook,
} from "@/modules/razorpay/client";
import {
  billingWebhookEventsPayload,
  getRazorpayConfig,
  publicRazorpayStatus,
  razorpayMode,
  razorpayWebhookUrl,
} from "@/modules/razorpay/config";
import type { createAdminClient } from "@/lib/supabase/admin";

const saveSchema = z.object({
  keyId: z.string().min(8),
  keySecret: z.string().optional().nullable(),
  webhookSecret: z.string().optional().nullable(),
});

function ip(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

async function pingWith(keyId: string, secret: string) {
  const response = await fetch("https://api.razorpay.com/v1/customers?count=1", {
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,
    },
  });
  const json = (await response.json().catch(() => ({}))) as {
    count?: number;
    error?: { description?: string } | string;
  };
  if (!response.ok) {
    const description =
      (typeof json.error === "object" ? json.error?.description : json.error) ||
      `Razorpay request failed (${response.status}).`;
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, description, json);
  }
  return json;
}

export async function loadRazorpaySettings() {
  const config = await getRazorpayConfig();
  return publicRazorpayStatus(config);
}

export async function saveRazorpaySettings(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext
) {
  const body = saveSchema.parse(await request.json());
  const current = await getRazorpayConfig();
  const keySecret = body.keySecret?.trim() || "";
  const webhookSecret = body.webhookSecret?.trim() || "";
  if (!current.keySecret && !keySecret) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Key secret is required the first time you connect Razorpay.");
  }
  const patch: Record<string, string | null> = {
    razorpay_key_id: body.keyId.trim(),
    razorpay_mode: razorpayMode(body.keyId.trim()),
  };
  if (keySecret) patch.encrypted_razorpay_key_secret = encryptSecret(keySecret);
  if (webhookSecret) patch.encrypted_razorpay_webhook_secret = encryptSecret(webhookSecret);
  const { error } = await supabase.from("platform_settings").update(patch).eq("id", 1);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  await writeBillingAudit(supabase, {
    actorId: ctx.userId,
    actorType: "SUPER_ADMIN",
    action: "razorpay.credentials_updated",
    targetType: "platform_settings",
    targetId: "1",
    ip: ip(request),
    metadata: {
      keyId: body.keyId.trim(),
      keySecretUpdated: Boolean(keySecret),
      webhookSecretUpdated: Boolean(webhookSecret),
      mode: razorpayMode(body.keyId.trim()),
    },
  });
  return loadRazorpaySettings();
}

export async function testRazorpaySettings(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext
) {
  const body = z
    .object({
      keyId: z.string().optional().nullable(),
      keySecret: z.string().optional().nullable(),
    })
    .parse(await request.json().catch(() => ({})));
  const overrideId = body.keyId?.trim() || "";
  const overrideSecret = body.keySecret?.trim() || "";
  const result =
    overrideId && overrideSecret
      ? await pingWith(overrideId, overrideSecret)
      : await pingRazorpayApi();
  const config = await getRazorpayConfig();
  const mode = razorpayMode(overrideId || config.keyId);
  await writeBillingAudit(supabase, {
    actorId: ctx.userId,
    actorType: "SUPER_ADMIN",
    action: "razorpay.api_tested",
    targetType: "platform_settings",
    targetId: "1",
    ip: ip(request),
    metadata: { mode, customerCount: result.count ?? 0, usedUnsavedKeys: Boolean(overrideId && overrideSecret) },
  });
  return { ok: true, mode, customerCount: result.count ?? 0 };
}

export async function registerRazorpayWebhook(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext
) {
  let config = await getRazorpayConfig();
  if (!config.keyId || !config.keySecret) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Save Razorpay API keys before registering the webhook.");
  }
  let secret = config.webhookSecret;
  if (!secret) {
    secret = randomToken(20);
    const { error } = await supabase
      .from("platform_settings")
      .update({ encrypted_razorpay_webhook_secret: encryptSecret(secret) })
      .eq("id", 1);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
  const url = razorpayWebhookUrl();
  const events = billingWebhookEventsPayload();
  let webhookId = config.webhookId;
  if (webhookId) {
    try {
      await updateRazorpayWebhook(webhookId, { url, secret, events });
    } catch {
      webhookId = null;
    }
  }
  if (!webhookId) {
    const listed = await listRazorpayWebhooks();
    const existing = (listed.items ?? []).find((item) => String(item.url ?? "") === url);
    if (existing?.id) {
      await updateRazorpayWebhook(String(existing.id), { url, secret, events });
      webhookId = String(existing.id);
    } else {
      const created = await createRazorpayWebhook({ url, secret, events });
      webhookId = String(created.id ?? "");
    }
  }
  if (!webhookId) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Razorpay did not return a webhook id.");
  }
  const { error } = await supabase.from("platform_settings").update({ razorpay_webhook_id: webhookId }).eq("id", 1);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  await writeBillingAudit(supabase, {
    actorId: ctx.userId,
    actorType: "SUPER_ADMIN",
    action: "razorpay.webhook_registered",
    targetType: "platform_settings",
    targetId: "1",
    ip: ip(request),
    metadata: { webhookId, url },
  });
  return { ...(await loadRazorpaySettings()), webhookId };
}
