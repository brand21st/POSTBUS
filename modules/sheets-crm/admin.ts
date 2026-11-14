import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { AdminContext } from "@/lib/api/admin-context";
import { rateLimit } from "@/lib/security/rate-limit";
import { writeBillingAudit } from "@/modules/billing/audit";
import { assertSheetsWebAppUrl } from "@/modules/sheets-crm/deliver-decision";
import {
  ensureSheetsCrmSecret,
  loadSheetsCrmConfig,
  publicSheetsCrmSettings,
  sheetsCrmReady,
} from "@/modules/sheets-crm/config";
import { testSheetsCrmConnection } from "@/modules/sheets-crm/deliver";
import { enqueueSheetsCrmEvent } from "@/modules/sheets-crm/enqueue";
import { renderSheetsCrmScript, sheetsCrmScriptSource } from "@/modules/sheets-crm/script";

const saveSchema = z.object({
  enabled: z.boolean().optional(),
  webAppUrl: z.string().max(500).optional(),
  noWorkspaceHours: z.number().int().min(1).max(720).optional(),
  indiaPostHours: z.number().int().min(1).max(720).optional(),
  onboardingHours: z.number().int().min(1).max(720).optional(),
  inactiveDays: z.number().int().min(1).max(365).optional(),
});

function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

async function countExact(query: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count, error } = await query;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return count ?? 0;
}

async function loadDashboard(supabase: SupabaseClient) {
  const config = await loadSheetsCrmConfig(supabase);
  const [signups, workspaces, active, recovered, abandoned, onboarding, pending] = await Promise.all([
    countExact(supabase.from("profiles").select("id", { count: "exact", head: true })),
    countExact(supabase.from("organizations").select("id", { count: "exact", head: true })),
    countExact(supabase.from("sheets_crm_projections").select("customer_id", { count: "exact", head: true }).eq("lifecycle", "active")),
    countExact(supabase.from("sheets_crm_projections").select("customer_id", { count: "exact", head: true }).eq("lifecycle", "recovered")),
    countExact(supabase.from("sheets_crm_projections").select("customer_id", { count: "exact", head: true }).eq("lifecycle", "abandoned")),
    countExact(
      supabase.from("sheets_crm_projections").select("customer_id", { count: "exact", head: true }).in("lifecycle", ["signup", "onboarding"])
    ),
    countExact(
      supabase.from("sheets_crm_outbox").select("id", { count: "exact", head: true }).in("status", ["PENDING", "FAILED", "PROCESSING"])
    ),
  ]);
  const attempts = config.syncedCount + config.failedCount;
  return {
    ...publicSheetsCrmSettings(config),
    stats: {
      signups,
      workspaces,
      active: active + recovered,
      abandoned,
      onboardingPending: onboarding,
      pendingSync: pending,
      successRate: attempts === 0 ? 100 : Math.round((config.syncedCount / attempts) * 100),
    },
  };
}

export async function handleSheetsCrmAdmin(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: AdminContext,
  slugs: string[],
  method: string
) {
  const key = `${method} ${slugs.join("/")}`;
  if (key === "GET ") return loadDashboard(supabase);
  if (key === "GET script") {
    const secret = await ensureSheetsCrmSecret(supabase);
    return { source: renderSheetsCrmScript(sheetsCrmScriptSource(), secret) };
  }
  if (key === "GET logs") {
    const { data, error } = await supabase
      .from("sheets_crm_sync_logs")
      .select("id, event_id, event_type, customer_id, status, retry_count, error, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return { logs: data ?? [] };
  }
  if (key === "PATCH ") return saveSettings(request, supabase, ctx);
  if (key === "POST test") return testConnection(request, supabase, ctx);
  if (key === "POST sync-all") return syncAll(request, supabase, ctx);
  if (key === "POST sync-failed") return syncFailed(request, supabase, ctx);
  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Unknown Google Sheets CRM route.");
}

async function saveSettings(request: NextRequest, supabase: SupabaseClient, ctx: AdminContext) {
  const body = saveSchema.parse(await request.json().catch(() => ({})));
  const patch: Record<string, unknown> = {};
  if (body.enabled !== undefined) patch.sheets_crm_enabled = body.enabled;
  if (body.webAppUrl !== undefined) {
    patch.sheets_crm_webapp_url = body.webAppUrl.trim() ? assertSheetsWebAppUrl(body.webAppUrl) : null;
  }
  if (body.noWorkspaceHours !== undefined) patch.sheets_crm_no_workspace_hours = body.noWorkspaceHours;
  if (body.indiaPostHours !== undefined) patch.sheets_crm_india_post_hours = body.indiaPostHours;
  if (body.onboardingHours !== undefined) patch.sheets_crm_onboarding_hours = body.onboardingHours;
  if (body.inactiveDays !== undefined) patch.sheets_crm_inactive_days = body.inactiveDays;
  if (!Object.keys(patch).length) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "No settings were provided.");
  const { error } = await supabase.from("platform_settings").update(patch).eq("id", 1);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  await ensureSheetsCrmSecret(supabase);
  await writeBillingAudit(supabase, {
    actorId: ctx.userId,
    actorType: "SUPER_ADMIN",
    action: "sheets_crm.settings_updated",
    ip: clientIp(request),
    metadata: {
      enabled: body.enabled ?? null,
      thresholds: {
        noWorkspaceHours: body.noWorkspaceHours ?? null,
        indiaPostHours: body.indiaPostHours ?? null,
        onboardingHours: body.onboardingHours ?? null,
        inactiveDays: body.inactiveDays ?? null,
      },
    },
  });
  return loadDashboard(supabase);
}

async function requireReady(supabase: SupabaseClient) {
  const config = await loadSheetsCrmConfig(supabase);
  if (!sheetsCrmReady(config)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enable the integration and save the Web App URL first.");
  }
  return config;
}

async function testConnection(request: NextRequest, supabase: SupabaseClient, ctx: AdminContext) {
  const limited = rateLimit(`sheets-crm-test:${ctx.userId}`, 10, 60_000);
  if (!limited.ok) throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many connection tests. Try again shortly.");
  const config = await requireReady(supabase);
  try {
    await testSheetsCrmConnection(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection test failed.";
    await supabase.from("platform_settings").update({ sheets_crm_last_error: message }).eq("id", 1);
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, message);
  }
  await supabase
    .from("platform_settings")
    .update({ sheets_crm_last_success_at: new Date().toISOString(), sheets_crm_last_error: null })
    .eq("id", 1);
  await writeBillingAudit(supabase, {
    actorId: ctx.userId,
    actorType: "SUPER_ADMIN",
    action: "sheets_crm.tested",
    ip: clientIp(request),
  });
  return loadDashboard(supabase);
}

async function syncAll(request: NextRequest, supabase: SupabaseClient, ctx: AdminContext) {
  const body = z.object({ cursor: z.string().uuid().optional() }).parse(await request.json().catch(() => ({})));
  if (!body.cursor) {
    const limited = rateLimit(`sheets-crm-sync-all:${ctx.userId}`, 1, 60_000);
    if (!limited.ok) throw new AppError(ERROR_CODES.RATE_LIMITED, "Sync all was just started. Wait a minute before starting again.");
  }
  await requireReady(supabase);
  let query = supabase.from("profiles").select("id").order("id", { ascending: true }).limit(500);
  if (body.cursor) query = query.gt("id", body.cursor);
  const { data, error } = await query;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const rows = data ?? [];
  let queued = 0;
  for (const row of rows) {
    const result = await enqueueSheetsCrmEvent(supabase, {
      eventType: "customer.signup.completed",
      customerId: row.id,
      force: true,
    });
    if (result.queued || result.reason === "duplicate") queued += 1;
  }
  const cursor = rows.length ? rows[rows.length - 1]!.id : body.cursor ?? null;
  const complete = rows.length < 500;
  if (!body.cursor) {
    await supabase.from("platform_settings").update({ sheets_crm_last_full_sync_at: new Date().toISOString() }).eq("id", 1);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "sheets_crm.sync_all",
      ip: clientIp(request),
      metadata: { queued },
    });
  }
  return { queued, complete, cursor };
}

async function syncFailed(request: NextRequest, supabase: SupabaseClient, ctx: AdminContext) {
  const limited = rateLimit(`sheets-crm-sync-failed:${ctx.userId}`, 5, 60_000);
  if (!limited.ok) throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many retries. Try again shortly.");
  await requireReady(supabase);
  const { data, error } = await supabase
    .from("sheets_crm_outbox")
    .update({
      status: "PENDING",
      attempt_count: 0,
      next_attempt_at: null,
      last_error: null,
      locked_at: null,
      force: true,
      updated_at: new Date().toISOString(),
    })
    .in("status", ["DEAD", "FAILED"])
    .select("id");
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const queued = data?.length ?? 0;
  await writeBillingAudit(supabase, {
    actorId: ctx.userId,
    actorType: "SUPER_ADMIN",
    action: "sheets_crm.sync_failed",
    ip: clientIp(request),
    metadata: { queued },
  });
  return { queued, ...(await loadDashboard(supabase)) };
}
