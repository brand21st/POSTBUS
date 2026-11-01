import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError, logInfo } from "@/lib/logger";
import { bookingQueueAutomationEnabledFor, bookingQueueEnabledFor } from "@/modules/booking-queue/flags";
import {
  AUTO_ENROLL_SOURCES,
  BATCH_THRESHOLD_RANGE,
  MAX_WAIT_RANGE,
  type AutoEnrollSource,
  type BookingAutomationSettings,
} from "@/modules/booking-queue/settings-shared";

export {
  AUTO_ENROLL_SOURCES,
  BATCH_THRESHOLD_PRESETS,
  BATCH_THRESHOLD_RANGE,
  MAX_WAIT_PRESETS,
  MAX_WAIT_RANGE,
  type AutoEnrollSource,
  type BookingAutomationSettings,
} from "@/modules/booking-queue/settings-shared";

export type BookingAutomationInput = {
  version: number;
  mode: "MANUAL" | "AUTOMATIC";
  enrollmentSources: AutoEnrollSource[];
  batchThreshold: number;
  maxWaitMinutes: number | null;
  paused: boolean;
};

export const DEFAULT_AUTOMATION: Omit<BookingAutomationSettings, "automationAvailable"> = {
  mode: "MANUAL",
  enrollmentSources: [],
  batchThreshold: 50,
  maxWaitMinutes: null,
  paused: false,
  pausedAt: null,
  version: 0,
  lastError: null,
  lastDispatchAt: null,
};

function wholeNumber(value: unknown) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) ? number : null;
}

/**
 * Server-side validation of a settings change. Throws a merchant-readable message.
 * Automatic mode needs a maximum wait so a small group of orders never waits forever.
 */
export function parseAutomationInput(body: unknown, options: { automationAvailable: boolean }): BookingAutomationInput {
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fail = (message: string): never => {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, message);
  };

  const version = wholeNumber(record.version);
  if (version === null || version < 0) fail("Reload the settings and try again.");

  const mode = record.mode === "AUTOMATIC" ? "AUTOMATIC" : record.mode === "MANUAL" ? "MANUAL" : fail("Choose Manual or Automatic.");
  if (mode === "AUTOMATIC" && !options.automationAvailable) {
    fail("Automatic booking is not available for this workspace yet.");
  }

  const rawSources = Array.isArray(record.enrollmentSources) ? record.enrollmentSources : [];
  const sources = [...new Set(rawSources.map((value) => String(value).toUpperCase()))];
  const unsupported = sources.filter((value) => !(AUTO_ENROLL_SOURCES as readonly string[]).includes(value));
  if (unsupported.length) fail(`Orders from ${unsupported.join(", ")} cannot join the queue by themselves yet.`);

  const batchThreshold = wholeNumber(record.batchThreshold);
  if (batchThreshold === null || batchThreshold < BATCH_THRESHOLD_RANGE.min || batchThreshold > BATCH_THRESHOLD_RANGE.max) {
    fail(`Batch size must be a whole number from ${BATCH_THRESHOLD_RANGE.min} to ${BATCH_THRESHOLD_RANGE.max}.`);
  }

  let maxWaitMinutes: number | null = null;
  if (record.maxWaitMinutes !== null && record.maxWaitMinutes !== undefined && record.maxWaitMinutes !== "") {
    maxWaitMinutes = wholeNumber(record.maxWaitMinutes);
    if (maxWaitMinutes === null || maxWaitMinutes < MAX_WAIT_RANGE.min || maxWaitMinutes > MAX_WAIT_RANGE.max) {
      fail(`Maximum wait must be from ${MAX_WAIT_RANGE.min} minutes to ${MAX_WAIT_RANGE.max / 60} hours.`);
    }
  }
  if (mode === "AUTOMATIC" && maxWaitMinutes === null) {
    fail("Automatic booking needs a maximum wait, so a few orders never wait forever.");
  }

  return {
    version: version as number,
    mode,
    enrollmentSources: sources as AutoEnrollSource[],
    batchThreshold: batchThreshold as number,
    maxWaitMinutes,
    paused: record.paused === true,
  };
}

type SettingsRow = {
  mode: string;
  enrollment_sources: string[] | null;
  batch_threshold: number;
  max_wait_minutes: number | null;
  paused_at: string | null;
  version: number;
  last_error: string | null;
  last_dispatch_at: string | null;
};

const SETTINGS_SELECT =
  "mode, enrollment_sources, batch_threshold, max_wait_minutes, paused_at, version, last_error, last_dispatch_at";

export function publicAutomationSettings(row: SettingsRow | null, automationAvailable: boolean): BookingAutomationSettings {
  if (!row) return { ...DEFAULT_AUTOMATION, automationAvailable };
  return {
    // A workspace taken out of the automation rollout behaves as manual.
    mode: row.mode === "AUTOMATIC" && automationAvailable ? "AUTOMATIC" : "MANUAL",
    enrollmentSources: (row.enrollment_sources ?? []).filter((value): value is AutoEnrollSource =>
      (AUTO_ENROLL_SOURCES as readonly string[]).includes(value)
    ),
    batchThreshold: Number(row.batch_threshold) || DEFAULT_AUTOMATION.batchThreshold,
    maxWaitMinutes: row.max_wait_minutes == null ? null : Number(row.max_wait_minutes),
    paused: Boolean(row.paused_at),
    pausedAt: row.paused_at,
    version: Number(row.version) || 1,
    automationAvailable,
    lastError: row.last_error,
    lastDispatchAt: row.last_dispatch_at,
  };
}

export async function getBookingAutomationSettings(supabase: SupabaseClient, ctx: TenantContext) {
  if (!bookingQueueEnabledFor(ctx.organizationId)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Bulk Booking queue is not enabled for this workspace yet.");
  }
  const { data, error } = await supabase
    .from("booking_automation_settings")
    .select(SETTINGS_SELECT)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return publicAutomationSettings((data as SettingsRow | null) ?? null, bookingQueueAutomationEnabledFor(ctx.organizationId));
}

/**
 * Saves settings with optimistic concurrency (`version`). Changing settings never touches a run
 * that is already batched or submitting; pausing only stops new automatic runs.
 */
export async function saveBookingAutomationSettings(supabase: SupabaseClient, ctx: TenantContext, body: unknown) {
  if (!bookingQueueEnabledFor(ctx.organizationId)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Bulk Booking queue is not enabled for this workspace yet.");
  }
  const automationAvailable = bookingQueueAutomationEnabledFor(ctx.organizationId);
  const input = parseAutomationInput(body, { automationAvailable });
  const { data: current, error: readError } = await supabase
    .from("booking_automation_settings")
    .select(`${SETTINGS_SELECT}, organization_id`)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (readError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, readError.message);

  const currentRow = current as (SettingsRow & { organization_id: string }) | null;
  const currentVersion = currentRow ? Number(currentRow.version) || 1 : 0;
  if (input.version !== currentVersion) {
    throw new AppError(ERROR_CODES.CONFLICT, "These settings were changed by someone else. Reload and try again.", {
      currentVersion,
    });
  }
  const now = new Date().toISOString();
  const pausedAt = input.paused ? currentRow?.paused_at ?? now : null;
  const fields = {
    mode: input.mode,
    enrollment_sources: input.enrollmentSources,
    batch_threshold: input.batchThreshold,
    max_wait_minutes: input.maxWaitMinutes,
    paused_at: pausedAt,
    paused_by: input.paused ? (currentRow?.paused_at ? undefined : ctx.userId || null) : null,
    updated_by: ctx.userId || null,
  };

  let saved: SettingsRow | null = null;
  if (!currentRow) {
    const { data, error } = await supabase
      .from("booking_automation_settings")
      .insert({ organization_id: ctx.organizationId, ...fields, version: 1 })
      .select(SETTINGS_SELECT)
      .single();
    if (error?.code === "23505") {
      throw new AppError(ERROR_CODES.CONFLICT, "These settings were changed by someone else. Reload and try again.");
    }
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    saved = data as SettingsRow;
  } else {
    const { data, error } = await supabase
      .from("booking_automation_settings")
      .update({ ...fields, version: currentVersion + 1 })
      .eq("organization_id", ctx.organizationId)
      .eq("version", currentVersion)
      .select(SETTINGS_SELECT)
      .maybeSingle();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    if (!data) {
      throw new AppError(ERROR_CODES.CONFLICT, "These settings were changed by someone else. Reload and try again.");
    }
    saved = data as SettingsRow;
  }

  try {
    await supabase.from("audit_logs").insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.userId || null,
      action: "booking_queue.settings_updated",
      entity_type: "booking_automation_settings",
      entity_id: ctx.organizationId,
      before: currentRow ? publicAutomationSettings(currentRow, automationAvailable) : null,
      after: publicAutomationSettings(saved, automationAvailable),
    });
  } catch (error) {
    logError("booking_queue.settings_audit_failed", {
      organizationId: ctx.organizationId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
  logInfo("booking_queue.settings_saved", {
    organizationId: ctx.organizationId,
    mode: input.mode,
    sources: input.enrollmentSources.join(","),
    paused: input.paused,
  });
  return publicAutomationSettings(saved, automationAvailable);
}

/**
 * Who books a new order from an integration import: the queue (when the workspace enrolled that
 * source) or the existing direct path (`automation_settings.auto_booking`). Never both.
 */
export async function resolveImportBookingRoute(
  supabase: SupabaseClient,
  organizationId: string,
  source: AutoEnrollSource
): Promise<"QUEUE" | "LEGACY"> {
  if (!bookingQueueEnabledFor(organizationId)) return "LEGACY";
  try {
    const { data, error } = await supabase
      .from("booking_automation_settings")
      .select("enrollment_sources")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error || !data) return "LEGACY";
    return (data.enrollment_sources ?? []).includes(source) ? "QUEUE" : "LEGACY";
  } catch {
    return "LEGACY";
  }
}
