import type { NextRequest } from "next/server";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { AdminContext } from "@/lib/api/admin-context";
import { encryptSecret } from "@/lib/security/crypto";
import { writeBillingAudit } from "@/modules/billing/audit";
import type { createAdminClient } from "@/lib/supabase/admin";
import { parseVachatBaseUrl } from "@/modules/vachat/signature";
import { probeVachatMe, vachatHeaders } from "@/modules/vachat/service";
import {
  getPlatformVachatConfig,
  parseVachatEventSettings,
  publicPlatformVachatStatus,
  vachatStatusWebhookUrl,
} from "@/modules/vachat/platform-config";
import { listVachatNotificationLogs, vachatNotificationStats } from "@/modules/vachat/logs";
import { withApprovedVachatTemplates } from "@/modules/vachat/templates";

const saveSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().optional().nullable(),
  apiBaseUrl: z.string().optional().nullable(),
  clearKey: z.boolean().optional(),
  eventSettings: z
    .object({
      order_confirmation: z.boolean().optional(),
      processing: z.boolean().optional(),
      booked: z.boolean().optional(),
      in_transit: z.boolean().optional(),
      shipment_delayed: z.boolean().optional(),
      delivered: z.boolean().optional(),
    })
    .optional(),
  templates: z
    .object({
      order_confirmation_template_name: z.string().nullable().optional(),
      processing_template_name: z.string().nullable().optional(),
      booked_template_name: z.string().nullable().optional(),
      in_transit_template_name: z.string().nullable().optional(),
      shipment_delayed_template_name: z.string().nullable().optional(),
      delivered_template_name: z.string().nullable().optional(),
      notification_settings: z.record(z.string(), z.boolean()).optional(),
      template_language: z.string().optional(),
    })
    .optional(),
  lastTestPhone: z.string().optional().nullable(),
});

function ip(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

async function vachatApi(
  path: string,
  init?: RequestInit,
  creds?: { apiKey: string; apiBaseUrl: string }
) {
  const config = creds ?? (await getPlatformVachatConfig());
  const apiKey = creds?.apiKey ?? config.apiKey;
  const apiBaseUrl = creds?.apiBaseUrl ?? config.apiBaseUrl;
  if (!apiKey) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Save a Vachat API key first.");
  }
  const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      ...vachatHeaders(apiKey),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(12000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (json && typeof json === "object" && "error" in json
        ? typeof (json as { error?: unknown }).error === "string"
          ? (json as { error: string }).error
          : (json as { error?: { message?: string } }).error?.message
        : null) || `VaChat ${path} failed (${res.status})`;
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, message);
  }
  return json as Record<string, unknown>;
}

function templateSyncPayload(body: z.infer<typeof saveSchema>, settings: ReturnType<typeof parseVachatEventSettings>) {
  const templates = body.templates;
  if (!templates) return null;
  const names = [
    templates.order_confirmation_template_name,
    templates.processing_template_name,
    templates.booked_template_name,
    templates.in_transit_template_name,
    templates.shipment_delayed_template_name,
    templates.delivered_template_name,
  ];
  const hasNamedTemplate = names.some((name) => typeof name === "string" && name.trim());
  if (!hasNamedTemplate) return null;
  return {
    ...templates,
    notification_settings: settings,
  };
}

export async function loadPlatformVachatSettings() {
  const status = publicPlatformVachatStatus(await getPlatformVachatConfig());
  let identity: {
    display_phone: string | null;
    verified_name: string | null;
    account_id: string | null;
  } = { display_phone: null, verified_name: null, account_id: null };
  let templates: Record<string, unknown> | null = null;
  let templatesLoadError: string | null = null;
  if (status.hasApiKey) {
    try {
      const idJson = await vachatApi("/api/postbus/identity");
      const data = (idJson.data ?? idJson) as {
        display_phone?: string | null;
        verified_name?: string | null;
        account_id?: string | null;
      };
      identity = {
        display_phone: data.display_phone ?? null,
        verified_name: data.verified_name ?? null,
        account_id: data.account_id ?? null,
      };
    } catch {
      identity = { display_phone: null, verified_name: null, account_id: null };
    }
    try {
      const tplJson = await vachatApi("/api/postbus/templates");
      templates = withApprovedVachatTemplates(tplJson);
    } catch (error) {
      templatesLoadError = error instanceof Error ? error.message : "Could not load VaChat templates.";
      templates = { approved_templates: [] };
    }
  }
  return { ...status, identity, templates, templatesLoadError };
}

export async function savePlatformVachatSettings(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext
) {
  const body = saveSchema.parse(await request.json());
  const current = await getPlatformVachatConfig();
  const incomingKey = body.apiKey?.trim() || "";
  if (!current.apiKey && !incomingKey && !body.clearKey) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Paste a Vachat API key the first time you connect.");
  }
  const apiBaseUrl = parseVachatBaseUrl(body.apiBaseUrl ?? current.apiBaseUrl);
  const patch: Record<string, unknown> = {
    vachat_api_base_url: apiBaseUrl,
  };
  if (typeof body.enabled === "boolean") patch.vachat_enabled = body.enabled;
  else if (!current.flagEnabled && incomingKey) patch.vachat_enabled = true;
  if (body.clearKey) {
    patch.encrypted_vachat_api_key = null;
    patch.vachat_enabled = false;
  } else if (incomingKey && !/^•+$/.test(incomingKey)) {
    patch.encrypted_vachat_api_key = encryptSecret(incomingKey);
  }
  if (body.eventSettings) {
    patch.vachat_event_settings = parseVachatEventSettings({
      ...current.eventSettings,
      ...body.eventSettings,
    });
  }
  if (typeof body.lastTestPhone === "string") {
    patch.vachat_last_test_phone = body.lastTestPhone.trim() || null;
  }
  const { error } = await supabase.from("platform_settings").update(patch).eq("id", 1);
  if (error) {
    const missingColumn = /does not exist/i.test(error.message);
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      missingColumn
        ? "This database is missing VaChat platform columns. Apply the platform_vachat migrations, then Save again."
        : error.message
    );
  }

  const nextKey = body.clearKey
    ? ""
    : incomingKey && !/^•+$/.test(incomingKey)
      ? incomingKey
      : current.apiKey;
  const settings = parseVachatEventSettings({
    ...current.eventSettings,
    ...(body.eventSettings ?? {}),
  });
  const syncBody = nextKey ? templateSyncPayload(body, settings) : null;
  let templateSyncError: string | null = null;
  if (syncBody) {
    try {
      await vachatApi(
        "/api/postbus/templates",
        { method: "PUT", body: JSON.stringify(syncBody) },
        { apiKey: nextKey, apiBaseUrl }
      );
      await supabase.from("platform_settings").update({ vachat_last_error: null }).eq("id", 1);
    } catch (syncError) {
      templateSyncError = syncError instanceof Error ? syncError.message : "VaChat template sync failed.";
      await supabase
        .from("platform_settings")
        .update({ vachat_last_error: templateSyncError })
        .eq("id", 1);
    }
  }

  await writeBillingAudit(supabase, {
    actorId: ctx.userId,
    actorType: "SUPER_ADMIN",
    action: "vachat.platform_credentials_updated",
    targetType: "platform_settings",
    targetId: "1",
    ip: ip(request),
    metadata: {
      apiBaseUrl,
      keyUpdated: Boolean(incomingKey && !/^•+$/.test(incomingKey)),
      keyCleared: Boolean(body.clearKey),
      enabled: patch.vachat_enabled ?? current.flagEnabled,
      eventsUpdated: Boolean(body.eventSettings),
      templatesUpdated: Boolean(body.templates),
      templateSyncError,
    },
  });
  return { ...(await loadPlatformVachatSettings()), templateSyncError };
}

export async function testPlatformVachatSettings(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext
) {
  const body = z
    .object({
      apiKey: z.string().optional().nullable(),
      apiBaseUrl: z.string().optional().nullable(),
    })
    .parse(await request.json().catch(() => ({})));
  const current = await getPlatformVachatConfig();
  const apiKey = body.apiKey?.trim() && !/^•+$/.test(body.apiKey.trim()) ? body.apiKey.trim() : current.apiKey;
  const apiBaseUrl = parseVachatBaseUrl(body.apiBaseUrl ?? current.apiBaseUrl);
  if (!apiKey) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Save a Vachat API key first.");
  }
  const me = (await probeVachatMe(apiBaseUrl, apiKey)) as {
    data?: { key?: { scopes?: string[] }; account?: { id?: string } };
    key?: { scopes?: string[] };
  };
  const scopes = me?.data?.key?.scopes ?? me?.key?.scopes ?? [];
  const hasSend = Array.isArray(scopes) && scopes.includes("postbus:send");
  const lastError = hasSend
    ? null
    : "Key is valid but missing postbus:send. Add that scope for global sending.";
  await supabase
    .from("platform_settings")
    .update({
      vachat_last_verified_at: new Date().toISOString(),
      vachat_last_error: lastError,
    })
    .eq("id", 1);
  await writeBillingAudit(supabase, {
    actorId: ctx.userId,
    actorType: "SUPER_ADMIN",
    action: "vachat.platform_api_tested",
    targetType: "platform_settings",
    targetId: "1",
    ip: ip(request),
    metadata: { hasPostbusSend: hasSend, scopes },
  });
  if (lastError) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, lastError);
  }
  return { ok: true, hasPostbusSend: true, me };
}

export async function sendPlatformVachatTest(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext
) {
  const body = z
    .object({
      phone: z.string().optional().nullable(),
      organizationId: z.string().uuid().optional().nullable(),
      event: z.string().optional().nullable(),
    })
    .parse(await request.json().catch(() => ({})));
  let organizationId = body.organizationId?.trim() || "";
  let shopName: string | null = null;
  if (!organizationId) {
    const { data: org } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("account_status", "ACTIVE")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    organizationId = org?.id ?? "";
    shopName = org?.name ?? null;
  }
  if (!organizationId) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Create a merchant account before sending a VaChat test.");
  }
  const { sendVachatTestNotice } = await import("@/modules/vachat/send");
  const result = await sendVachatTestNotice(supabase, organizationId, {
    phone: body.phone,
    event: body.event,
    shopName,
  });
  await supabase
    .from("platform_settings")
    .update({ vachat_last_test_phone: result.to.replace(/^\+/, "") })
    .eq("id", 1);
  await writeBillingAudit(supabase, {
    actorId: ctx.userId,
    actorType: "SUPER_ADMIN",
    action: "vachat.platform_test_sent",
    targetType: "organization",
    targetId: organizationId,
    ip: ip(request),
    metadata: { to: result.to, event: result.event },
  });
  return result;
}

export async function registerPlatformVachatWebhook(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext
) {
  const config = await getPlatformVachatConfig();
  if (!config.apiKey) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Save a Vachat API key before registering the webhook.");
  }
  const webhookUrl = vachatStatusWebhookUrl();
  if (!webhookUrl.startsWith("https://")) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "APP URL must be https:// to register the VaChat webhook.");
  }
  const res = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/api/v1/webhooks`, {
    method: "POST",
    headers: vachatHeaders(config.apiKey),
    body: JSON.stringify({
      url: webhookUrl,
        events: ["message.status_updated", "message.received"],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AppError(
      ERROR_CODES.INTEGRATION_NOT_CONNECTED,
      `VaChat webhook registration failed (${res.status}): ${text.slice(0, 180)}`
    );
  }
  const json = (await res.json().catch(() => null)) as {
    data?: { secret?: string; id?: string };
  } | null;
  const secret = json?.data?.secret;
  const endpointId = json?.data?.id ?? null;
  const patch: Record<string, unknown> = {
    vachat_webhook_endpoint_id: endpointId,
    vachat_last_error: null,
  };
  if (typeof secret === "string" && secret) {
    patch.encrypted_vachat_webhook_secret = encryptSecret(secret);
  }
  const { error } = await supabase.from("platform_settings").update(patch).eq("id", 1);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  await writeBillingAudit(supabase, {
    actorId: ctx.userId,
    actorType: "SUPER_ADMIN",
    action: "vachat.platform_webhook_registered",
    targetType: "platform_settings",
    targetId: "1",
    ip: ip(request),
    metadata: { endpointId, url: webhookUrl },
  });
  return loadPlatformVachatSettings();
}

export async function loadPlatformVachatStats(supabase: ReturnType<typeof createAdminClient>) {
  return vachatNotificationStats(supabase);
}

export async function loadPlatformVachatLogs(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>
) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  const limit = Number(url.searchParams.get("limit") || "50");
  return listVachatNotificationLogs(supabase, {
    organizationId,
    limit: Number.isFinite(limit) ? limit : 50,
  });
}
