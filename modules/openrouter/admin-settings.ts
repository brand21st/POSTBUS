import type { NextRequest } from "next/server";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { AdminContext } from "@/lib/api/admin-context";
import { encryptSecret } from "@/lib/security/crypto";
import { writeBillingAudit } from "@/modules/billing/audit";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchOpenRouterChatGptModels,
  mergeChatGptModels,
} from "@/modules/openrouter/chatgpt-models";
import {
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_API_BASE,
  getPlatformOpenRouterConfig,
  openRouterReferer,
  publicOpenRouterStatus,
  sanitizeOpenRouterModel,
} from "@/modules/openrouter/platform-config";

const saveSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  clearKey: z.boolean().optional(),
});

function ip(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function loadOpenRouterSettings() {
  const config = await getPlatformOpenRouterConfig();
  const live = await fetchOpenRouterChatGptModels(config.apiKey);
  return {
    ...publicOpenRouterStatus(config),
    models: mergeChatGptModels(live, config.model),
  };
}

export async function listOpenRouterChatGptModelsForAdmin() {
  const config = await getPlatformOpenRouterConfig();
  const live = await fetchOpenRouterChatGptModels(config.apiKey);
  return { models: mergeChatGptModels(live, config.model), selected: config.model };
}

export async function saveOpenRouterSettings(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext
) {
  const body = saveSchema.parse(await request.json());
  const current = await getPlatformOpenRouterConfig();
  const incomingKey = body.apiKey?.trim() || "";
  if (!current.apiKey && !incomingKey && !body.clearKey) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Paste an OpenRouter API key the first time you connect.");
  }
  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") patch.openrouter_enabled = body.enabled;
  else if (!current.flagEnabled && incomingKey) patch.openrouter_enabled = true;
  if (body.model != null) patch.openrouter_model = sanitizeOpenRouterModel(body.model);
  if (body.clearKey) {
    patch.encrypted_openrouter_api_key = null;
    patch.openrouter_enabled = false;
  } else if (incomingKey && !/^•+$/.test(incomingKey)) {
    patch.encrypted_openrouter_api_key = encryptSecret(incomingKey);
  }
  const { error } = await supabase.from("platform_settings").update(patch).eq("id", 1);
  if (error) {
    const missingColumn = /does not exist/i.test(error.message);
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      missingColumn
        ? "This database is missing OpenRouter platform columns. Apply the platform_openrouter migration, then Save again."
        : error.message
    );
  }
  await writeBillingAudit(supabase, {
    actorId: ctx.userId,
    actorType: "SUPER_ADMIN",
    action: "openrouter.credentials_updated",
    targetType: "platform_settings",
    targetId: "1",
    ip: ip(request),
    metadata: {
      enabled: patch.openrouter_enabled ?? current.flagEnabled,
      model: patch.openrouter_model ?? current.model,
      keyUpdated: Boolean(incomingKey && !/^•+$/.test(incomingKey)),
      cleared: Boolean(body.clearKey),
    },
  });
  return loadOpenRouterSettings();
}

async function pingOpenRouter(apiKey: string) {
  const response = await fetch(`${OPENROUTER_API_BASE}/auth/key`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": openRouterReferer(),
      "X-Title": "PostBus",
    },
    signal: AbortSignal.timeout(12000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    data?: { label?: string };
    error?: { message?: string } | string;
  };
  if (!response.ok) {
    const message =
      (typeof json.error === "object" ? json.error?.message : json.error) ||
      `OpenRouter request failed (${response.status}).`;
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, message, json);
  }
  return json;
}

export async function testOpenRouterSettings(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext
) {
  const body = z
    .object({ apiKey: z.string().optional().nullable() })
    .parse(await request.json().catch(() => ({})));
  const override = body.apiKey?.trim() || "";
  const config = await getPlatformOpenRouterConfig();
  const apiKey = override || config.apiKey;
  if (!apiKey) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Save an OpenRouter API key first.");
  }
  const result = await pingOpenRouter(apiKey);
  await writeBillingAudit(supabase, {
    actorId: ctx.userId,
    actorType: "SUPER_ADMIN",
    action: "openrouter.api_tested",
    targetType: "platform_settings",
    targetId: "1",
    ip: ip(request),
    metadata: { usedUnsavedKey: Boolean(override), label: result.data?.label ?? null },
  });
  return { ok: true, model: config.model || DEFAULT_OPENROUTER_MODEL, label: result.data?.label ?? null };
}
