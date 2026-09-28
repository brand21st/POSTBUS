import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logInfo } from "@/lib/logger";
import { getAutomationSettings } from "@/modules/automation/service";

export type PrinterConnectionType = "webusb" | "agent";
export type PrinterProtocol = "tspl" | "zpl" | "escpos" | "unknown";
export type PrintDelivery = "webusb" | "agent";

export type PrinterRecord = {
  id: string;
  displayName: string;
  connectionType: PrinterConnectionType;
  deviceKey: string;
  protocol: PrinterProtocol;
  isDefault: boolean;
  lastSeenAt: string | null;
};

type PrinterRow = {
  id: string;
  organization_id?: string;
  display_name: string;
  connection_type: PrinterConnectionType;
  device_key: string;
  protocol: PrinterProtocol;
  is_default: boolean;
  last_seen_at?: string | null;
};

export type DefaultPrinterRow = {
  id: string;
  organizationId: string;
  isDefault: boolean;
};

export function applySingleDefault(rows: DefaultPrinterRow[], organizationId: string, printerId: string) {
  const inOrg = rows.filter((row) => row.organizationId === organizationId);
  if (!inOrg.some((row) => row.id === printerId)) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Printer not found.");
  }
  return rows.map((row) =>
    row.organizationId === organizationId ? { ...row, isDefault: row.id === printerId } : row
  );
}

export function clearDefaultsForAgentPrinter(flags: boolean[], selectedPrinterName: string | null) {
  if (!selectedPrinterName?.trim()) return flags;
  return flags.map(() => false);
}

function uniqueViolation(error: { code?: string; message?: string } | null) {
  return error?.code === "23505" || /duplicate key|printers_one_default/i.test(error?.message ?? "");
}

export function mapPrinter(row: PrinterRow): PrinterRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    connectionType: row.connection_type,
    deviceKey: row.device_key,
    protocol: row.protocol,
    isDefault: Boolean(row.is_default),
    lastSeenAt: row.last_seen_at ?? null,
  };
}

const PRINTER_COLUMNS = "id, display_name, connection_type, device_key, protocol, is_default, last_seen_at";

async function audit(
  supabase: SupabaseClient,
  ctx: TenantContext,
  action: string,
  printerId: string,
  after?: Record<string, unknown>
) {
  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action,
    entity_type: "printer",
    entity_id: printerId,
    after: after ?? null,
  });
}

export async function listPrinters(supabase: SupabaseClient, organizationId: string) {
  const [{ data, error }, automation] = await Promise.all([
    supabase
      .from("printers")
      .select(PRINTER_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true }),
    getAutomationSettings(supabase, organizationId),
  ]);
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not load printers.");
  }
  const printers = ((data ?? []) as PrinterRow[]).map(mapPrinter);
  return {
    printers,
    autoLabelPrinting: Boolean(automation.autoLabelPrinting),
    labelSizeLabel: "105 × 148 mm (A6)",
  };
}

export async function getDefaultWebusbPrinter(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("printers")
    .select("id, display_name, connection_type")
    .eq("organization_id", organizationId)
    .eq("is_default", true)
    .eq("connection_type", "webusb")
    .maybeSingle();
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not load the default printer.");
  }
  if (!data || data.connection_type !== "webusb") return null;
  return { id: String(data.id), displayName: String(data.display_name) };
}

export async function registerPrinter(
  supabase: SupabaseClient,
  ctx: TenantContext,
  input: { displayName: string; deviceKey: string; protocol: "tspl" }
) {
  const payload = {
    organization_id: ctx.organizationId,
    display_name: input.displayName.trim(),
    connection_type: "webusb" as const,
    device_key: input.deviceKey,
    protocol: input.protocol,
    is_default: false,
    last_seen_at: new Date().toISOString(),
  };

  const { data: existing, error: existingError } = await supabase
    .from("printers")
    .select(PRINTER_COLUMNS)
    .eq("organization_id", ctx.organizationId)
    .eq("device_key", input.deviceKey)
    .maybeSingle();
  if (existingError) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save the printer.");
  }

  if (existing) {
    const { data, error } = await supabase
      .from("printers")
      .update({
        display_name: payload.display_name,
        protocol: payload.protocol,
        last_seen_at: payload.last_seen_at,
      })
      .eq("id", existing.id)
      .eq("organization_id", ctx.organizationId)
      .select(PRINTER_COLUMNS)
      .single();
    if (error || !data) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save the printer.");
    }
    logInfo("printer.connected", { organizationId: ctx.organizationId, printerId: data.id });
    return mapPrinter(data as PrinterRow);
  }

  const { data, error } = await supabase.from("printers").insert(payload).select(PRINTER_COLUMNS).single();
  if (error || !data) {
    if (uniqueViolation(error)) {
      throw new AppError(ERROR_CODES.CONFLICT, "This printer is already saved. Refresh and try again.");
    }
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not save the printer.");
  }

  await audit(supabase, ctx, "printer.connected", data.id, { displayName: payload.display_name });
  logInfo("printer.connected", { organizationId: ctx.organizationId, printerId: data.id });
  return mapPrinter(data as PrinterRow);
}

export async function setDefaultPrinter(supabase: SupabaseClient, ctx: TenantContext, printerId: string) {
  const { data, error } = await supabase.rpc("set_default_printer", { p_printer_id: printerId });
  if (error || !data) {
    const message = error?.message ?? "";
    if (error?.code === "P0002" || /printer not found/i.test(message)) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Printer not found.");
    }
    if (error?.code === "42501" || /forbidden/i.test(message)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "You do not have access to this printer.");
    }
    if (uniqueViolation(error)) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        "Another default printer was just selected. Refresh and try again."
      );
    }
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not set the default printer.");
  }

  const row = (Array.isArray(data) ? data[0] : data) as PrinterRow;
  if (!row?.id || (row.organization_id && row.organization_id !== ctx.organizationId)) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Printer not found.");
  }
  await audit(supabase, ctx, "printer.default_changed", row.id, { displayName: row.display_name });
  logInfo("printer.default_changed", { organizationId: ctx.organizationId, printerId: row.id });
  return mapPrinter({ ...row, is_default: true });
}

export async function removePrinter(supabase: SupabaseClient, ctx: TenantContext, printerId: string) {
  const { data: existing, error: readError } = await supabase
    .from("printers")
    .select("id")
    .eq("id", printerId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (readError) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not remove the printer.");
  }
  if (!existing) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Printer not found.");
  }

  const { error } = await supabase
    .from("printers")
    .delete()
    .eq("id", printerId)
    .eq("organization_id", ctx.organizationId);
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not remove the printer.");
  }

  await audit(supabase, ctx, "printer.removed", printerId);
  logInfo("printer.disconnected", { organizationId: ctx.organizationId, printerId });
  return { id: printerId };
}

export async function recordPrinterPresence(
  supabase: SupabaseClient,
  ctx: TenantContext,
  printerId: string,
  state: "connected" | "disconnected"
) {
  const { data, error } = await supabase
    .from("printers")
    .select("id")
    .eq("id", printerId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not update the printer.");
  }
  if (!data) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Printer not found.");
  }

  if (state === "connected") {
    const { error: updateError } = await supabase
      .from("printers")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", printerId)
      .eq("organization_id", ctx.organizationId);
    if (updateError) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not update the printer.");
    }
  }

  logInfo(state === "connected" ? "printer.connected" : "printer.disconnected", {
    organizationId: ctx.organizationId,
    printerId,
  });
  return { id: printerId, state };
}

const PRINTER_EVENTS = {
  test_requested: "print.test_requested",
  test_succeeded: "print.succeeded",
  test_failed: "print.failed",
} as const;

export async function recordPrinterEvent(
  supabase: SupabaseClient,
  ctx: TenantContext,
  printerId: string,
  event: keyof typeof PRINTER_EVENTS
) {
  const { data, error } = await supabase
    .from("printers")
    .select("id")
    .eq("id", printerId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not update the printer.");
  }
  if (!data) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Printer not found.");
  }
  logInfo(PRINTER_EVENTS[event], {
    organizationId: ctx.organizationId,
    printerId,
    kind: "test",
  });
  return { id: printerId };
}
