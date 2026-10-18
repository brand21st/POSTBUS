import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logInfo } from "@/lib/logger";
import { hashSecret, randomToken, safeEqual } from "@/lib/security/crypto";
import { isPrintPaperSize, agentPaperSize, printMediaForPage } from "@/modules/labels/page-presets";
import { mmFromPt } from "@/modules/labels/layout/units";
import { paperSizeForLabelKind } from "@/modules/labels/print-targets";
import { loadLabelPdfBytes } from "@/modules/labels/load";
import { DEVICE_ONLINE_MS } from "@/modules/print/device-pairing";
import { STALE_PRINT_REVIEW_MESSAGE } from "@/modules/print/queued-message";
import { getDefaultWebusbPrinter, type PrintDelivery } from "@/modules/print/printers";

export const PRINT_AGENT_ONLINE_MS = 30_000;
export const PRINTING_STALE_MS = 120_000;

export const PRINT_DEFAULTS = {
  paperSize: "A6" as const,
  orientation: "portrait" as const,
  copies: 1,
};

export type PrintJobStatus = "PENDING" | "PRINTING" | "PRINTED" | "FAILED" | "NEEDS_REVIEW";
export type PrintJobSource = "AUTO" | "MANUAL";
export type PrintClaimSource = "legacy" | "device" | "webusb";

export type PrintSettings = {
  organizationId: string;
  selectedPrinterName: string | null;
  selectedDeviceId: string | null;
  paperSize: string;
  orientation: string;
  copies: number;
  autoPrintMerchant: boolean;
};

export type PrintAgentRow = {
  id: string;
  organization_id: string;
  name: string;
  token_prefix: string;
  token_hash: string;
  last_seen_at: string | null;
  printers: unknown;
};

export type PrintJobRow = {
  id: string;
  organization_id: string;
  shipment_id: string;
  label_id: string;
  printer_name: string | null;
  source: PrintJobSource;
  status: PrintJobStatus;
  error_message: string | null;
  claimed_at: string | null;
  printed_at: string | null;
  created_at: string;
  paper_size?: string | null;
  copies?: number | null;
  delivery?: string | null;
  device_id?: string | null;
  claimed_by_device_id?: string | null;
  claim_id?: string | null;
  idempotency_key?: string | null;
  reprinted_from_job_id?: string | null;
};

export type PrintStation = {
  selectedPrinterName: string | null;
  paperSize: string;
  orientation: string;
  copies: number;
  autoPrintMerchant?: boolean;
  connected: boolean;
  printerNames: string[];
  agentName: string | null;
  tokenPrefix: string | null;
  lastSeenAt: string | null;
  offlineMessage: string | null;
  defaultDelivery: "webusb" | "agent";
  selectedDeviceId: string | null;
  devices: PrintStationDevice[];
};

export type PrintStationDevice = {
  id: string;
  deviceName: string;
  connection: "online" | "offline";
  printers: string[];
  selected: boolean;
};

export type PrintAgentContext = {
  agentId: string;
  organizationId: string;
};

function asPrinterList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function jobDelivery(job: { delivery?: string | null }): PrintDelivery {
  return job.delivery === "webusb" ? "webusb" : "agent";
}

export function isPrintDeviceOnline(lastSeenAt: string | null | undefined, now = Date.now()) {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) return false;
  return now - seen <= DEVICE_ONLINE_MS;
}

type ActivePrintDevice = {
  id: string;
  device_name: string;
  last_seen_at: string | null;
  last_printers: unknown;
};

async function listActivePrintDevices(supabase: SupabaseClient, organizationId: string): Promise<ActivePrintDevice[]> {
  try {
    const { data, error } = await supabase
      .from("print_devices")
      .select("id, device_name, last_seen_at, last_printers, status")
      .eq("organization_id", organizationId)
      .eq("status", "active");
    if (error) return [];
    return (data ?? []) as ActivePrintDevice[];
  } catch {
    return [];
  }
}

async function onlineDevicePrinters(supabase: SupabaseClient, organizationId: string) {
  const empty = {
    names: [] as string[],
    online: false,
    lastSeenAt: null as string | null,
    agentName: null as string | null,
    devices: [] as ActivePrintDevice[],
    live: [] as ActivePrintDevice[],
  };
  const devices = await listActivePrintDevices(supabase, organizationId);
  if (!devices.length) return empty;
  const now = Date.now();
  const live = devices.filter((row) => isPrintDeviceOnline(row.last_seen_at, now));
  const names = [...new Set(live.flatMap((row) => asPrinterList(row.last_printers)))];
  const newest = [...live].sort(
    (left, right) => new Date(right.last_seen_at ?? 0).getTime() - new Date(left.last_seen_at ?? 0).getTime()
  )[0];
  return {
    names,
    online: live.length > 0 && names.length > 0,
    lastSeenAt: newest?.last_seen_at ?? null,
    agentName: newest?.device_name ?? null,
    devices,
    live,
  };
}

function pickStationDevice(devices: ActivePrintDevice[], selectedDeviceId: string | null) {
  if (selectedDeviceId) {
    const selected = devices.find((row) => row.id === selectedDeviceId);
    if (selected) return selected;
  }
  if (devices.length === 1) return devices[0];
  return null;
}

async function printTarget(
  supabase: SupabaseClient,
  organizationId: string,
  settings: PrintSettings,
  options?: { requireDevice?: boolean }
): Promise<{ delivery: PrintDelivery; printerName: string | null; deviceId: string | null }> {
  const windows = await onlineDevicePrinters(supabase, organizationId);
  if (windows.devices.length) {
    const device = pickStationDevice(windows.devices, settings.selectedDeviceId);
    if (!device) {
      if (options?.requireDevice) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          "Select a Print Agent computer in Settings → Printing before printing."
        );
      }
      return { delivery: "agent", printerName: settings.selectedPrinterName, deviceId: null };
    }
    const printers = asPrinterList(device.last_printers);
    const printerName = settings.selectedPrinterName;
    if (options?.requireDevice && printerName && printers.length > 0 && !printers.includes(printerName)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        "That printer is not on the selected Print Agent computer."
      );
    }
    return { delivery: "agent", printerName, deviceId: device.id };
  }
  const usb = await getDefaultWebusbPrinter(supabase, organizationId);
  if (usb) return { delivery: "webusb", printerName: usb.displayName, deviceId: null };
  return { delivery: "agent", printerName: settings.selectedPrinterName, deviceId: null };
}

function uniqueViolation(error: { code?: string; message?: string } | null) {
  return error?.code === "23505" || /duplicate key/i.test(error?.message ?? "");
}

export function isPrintAgentOnline(lastSeenAt: string | null | undefined, now = Date.now()) {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) return false;
  return now - seen <= PRINT_AGENT_ONLINE_MS;
}

export function mapPrintSettings(row: {
  organization_id: string;
  selected_printer_name?: string | null;
  selected_device_id?: string | null;
  paper_size?: string | null;
  orientation?: string | null;
  copies?: number | null;
  auto_print_merchant?: boolean | null;
}): PrintSettings {
  return {
    organizationId: row.organization_id,
    selectedPrinterName: row.selected_printer_name?.trim() || null,
    selectedDeviceId: row.selected_device_id?.trim() || null,
    paperSize: row.paper_size || PRINT_DEFAULTS.paperSize,
    orientation: row.orientation || PRINT_DEFAULTS.orientation,
    copies: Number(row.copies) || PRINT_DEFAULTS.copies,
    autoPrintMerchant: row.auto_print_merchant !== false,
  };
}

export function mapPrintJob(row: PrintJobRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    shipmentId: row.shipment_id,
    labelId: row.label_id,
    printerName: row.printer_name,
    source: row.source,
    status: row.status,
    errorMessage: row.error_message,
    claimedAt: row.claimed_at,
    printedAt: row.printed_at,
    createdAt: row.created_at,
  };
}

export function printStatusForJob(job?: { status?: string | null } | null) {
  const status = (job?.status ?? "").toUpperCase();
  if (status === "PRINTED") return "PRINTED";
  if (status === "FAILED") return "FAILED";
  if (status === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  if (status === "PRINTING") return "PRINTING";
  if (status === "PENDING") return "WAITING";
  return null;
}

export async function getPrintSettings(
  supabase: SupabaseClient,
  organizationId: string
): Promise<PrintSettings> {
  const { data, error } = await supabase
    .from("print_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
  if (data) return mapPrintSettings(data);

  const { data: created, error: insertError } = await supabase
    .from("print_settings")
    .insert({
      organization_id: organizationId,
      paper_size: PRINT_DEFAULTS.paperSize,
      orientation: PRINT_DEFAULTS.orientation,
      copies: PRINT_DEFAULTS.copies,
    })
    .select("*")
    .single();

  if (insertError) {
    if (uniqueViolation(insertError)) {
      const { data: again } = await supabase
        .from("print_settings")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (again) return mapPrintSettings(again);
    }
    return mapPrintSettings({
      organization_id: organizationId,
      selected_printer_name: null,
      selected_device_id: null,
      paper_size: PRINT_DEFAULTS.paperSize,
      orientation: PRINT_DEFAULTS.orientation,
      copies: PRINT_DEFAULTS.copies,
    });
  }
  return mapPrintSettings(created);
}

export async function updatePrintSettings(
  supabase: SupabaseClient,
  ctx: TenantContext,
  patch: {
    selectedPrinterName?: string | null;
    selectedDeviceId?: string | null;
    paperSize?: string;
    orientation?: string;
    copies?: number;
    autoPrintMerchant?: boolean;
  }
): Promise<PrintSettings> {
  await getPrintSettings(supabase, ctx.organizationId);
  const updates: Record<string, unknown> = {};
  if (patch.selectedPrinterName !== undefined) {
    updates.selected_printer_name = patch.selectedPrinterName?.trim() || null;
  }
  if (patch.selectedDeviceId !== undefined) {
    const deviceId = patch.selectedDeviceId?.trim() || null;
    if (deviceId) {
      const { data: device } = await supabase
        .from("print_devices")
        .select("id")
        .eq("id", deviceId)
        .eq("organization_id", ctx.organizationId)
        .eq("status", "active")
        .maybeSingle();
      if (!device) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, "That Print Agent computer is not available.");
      }
    }
    updates.selected_device_id = deviceId;
  }
  if (patch.paperSize !== undefined) {
    if (!isPrintPaperSize(patch.paperSize)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Paper size must be A6, 4x6, A5, A4, or A3.");
    }
    updates.paper_size = patch.paperSize;
  }
  if (patch.orientation !== undefined) {
    if (!["portrait", "landscape"].includes(patch.orientation)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Orientation must be portrait or landscape.");
    }
    updates.orientation = patch.orientation;
  }
  if (patch.copies !== undefined) {
    const copies = Number(patch.copies);
    if (!Number.isInteger(copies) || copies < 1 || copies > 5) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Copies must be between 1 and 5.");
    }
    updates.copies = copies;
  }
  if (patch.autoPrintMerchant !== undefined) {
    updates.auto_print_merchant = Boolean(patch.autoPrintMerchant);
  }
  if (Object.keys(updates).length === 0) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "No printer settings were provided.");
  }

  const { data, error } = await supabase
    .from("print_settings")
    .update(updates)
    .eq("organization_id", ctx.organizationId)
    .select("*")
    .single();
  if (error || !data) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not save printer settings.");
  }
  return mapPrintSettings(data);
}

export async function getPrintStation(
  supabase: SupabaseClient,
  organizationId: string
): Promise<PrintStation> {
  const settings = await getPrintSettings(supabase, organizationId);
  const { data: agent } = await supabase
    .from("print_agents")
    .select("id, name, token_prefix, last_seen_at, printers")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const usbDefault = await getDefaultWebusbPrinter(supabase, organizationId);
  const windows = await onlineDevicePrinters(supabase, organizationId);
  const stationDevice = pickStationDevice(windows.devices, settings.selectedDeviceId);
  const stationPrinters = stationDevice ? asPrinterList(stationDevice.last_printers) : windows.names;
  const agentPrinters = asPrinterList(agent?.printers);
  const printerNames = [...new Set([...(stationDevice ? stationPrinters : windows.names), ...agentPrinters])];
  const agentOnline = isPrintAgentOnline(agent?.last_seen_at) && agentPrinters.length > 0;
  const selectedDeviceOnline = Boolean(
    stationDevice && isPrintDeviceOnline(stationDevice.last_seen_at) && stationPrinters.length > 0
  );
  const connected = (selectedDeviceOnline || (!windows.devices.length && agentOnline)) && printerNames.length > 0;
  const selected = settings.selectedPrinterName;
  const selectedOnline = Boolean(selected && printerNames.includes(selected));
  let offlineMessage: string | null = null;
  if (windows.devices.length > 1 && !stationDevice) {
    offlineMessage = "Select which packing computer should print in Settings → Printing.";
  } else if (selectedDeviceOnline || agentOnline) {
    if (selected && !selectedOnline) {
      offlineMessage = `Printer unavailable (${selected}). Jobs stay on this computer until that printer reconnects.`;
    }
  } else if (!agent?.token_prefix && !windows.devices.length) {
    offlineMessage = "Install PostBus Print Agent on the packing computer, then pair it in Settings → Printing.";
  } else if (!selectedDeviceOnline && !isPrintAgentOnline(agent?.last_seen_at)) {
    offlineMessage =
      "No printer detected. Open PostBus Print Agent on the packing computer. Queued jobs stay on that computer.";
  } else if (printerNames.length === 0) {
    offlineMessage = "The print agent is online, but no printers were reported. Check the computer's printers.";
  }

  const devices: PrintStationDevice[] = windows.devices.map((row) => ({
    id: row.id,
    deviceName: row.device_name,
    connection: isPrintDeviceOnline(row.last_seen_at) ? "online" : "offline",
    printers: asPrinterList(row.last_printers),
    selected: stationDevice?.id === row.id,
  }));

  return {
    selectedPrinterName: selected,
    selectedDeviceId: stationDevice?.id ?? null,
    devices,
    paperSize: settings.paperSize,
    orientation: settings.orientation,
    copies: settings.copies,
    autoPrintMerchant: settings.autoPrintMerchant,
    connected: connected && (!selected || selectedOnline),
    printerNames,
    agentName: stationDevice?.device_name ?? windows.agentName ?? agent?.name ?? null,
    tokenPrefix: agent?.token_prefix ?? null,
    lastSeenAt: stationDevice?.last_seen_at ?? windows.lastSeenAt ?? agent?.last_seen_at ?? null,
    offlineMessage: usbDefault && !windows.devices.length && !windows.online
      ? "Direct USB printing is the default. Manage it in Settings → Printing."
      : offlineMessage,
    defaultDelivery: windows.devices.length || windows.online || !usbDefault ? "agent" : "webusb",
  };
}

export async function rotatePrintAgentToken(
  supabase: SupabaseClient,
  ctx: TenantContext
): Promise<{ token: string; tokenPrefix: string; agentId: string }> {
  const token = `pb_print_${randomToken(24)}`;
  const tokenPrefix = token.slice(0, 16);
  const payload = {
    organization_id: ctx.organizationId,
    name: "PostBus Label Printer",
    token_prefix: tokenPrefix,
    token_hash: hashSecret(token),
    last_seen_at: null,
    printers: [],
  };

  const { data: existing } = await supabase
    .from("print_agents")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();

  let row: { id: string } | null = null;
  if (existing?.id) {
    const { data, error } = await supabase
      .from("print_agents")
      .update(payload)
      .eq("id", existing.id)
      .eq("organization_id", ctx.organizationId)
      .select("id")
      .single();
    if (error || !data) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not rotate the print agent token.");
    }
    row = data;
  } else {
    const { data, error } = await supabase.from("print_agents").insert(payload).select("id").single();
    if (error || !data) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not create the print agent token.");
    }
    row = data;
  }

  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "print_agent.token_rotated",
    entity_type: "print_agent",
    entity_id: row.id,
  });

  return { token, tokenPrefix, agentId: row.id };
}

export async function authenticatePrintAgent(
  supabase: SupabaseClient,
  authorization: string | null
): Promise<PrintAgentContext> {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token.startsWith("pb_print_")) {
    throw new AppError(ERROR_CODES.AUTH_REQUIRED, "The print agent token is missing or invalid.");
  }
  const prefix = token.slice(0, 16);
  const { data, error } = await supabase
    .from("print_agents")
    .select("id, organization_id, token_hash")
    .eq("token_prefix", prefix)
    .maybeSingle();
  if (error || !data || !safeEqual(data.token_hash, hashSecret(token))) {
    throw new AppError(ERROR_CODES.AUTH_REQUIRED, "The print agent token is missing or invalid.");
  }
  return { agentId: data.id, organizationId: data.organization_id };
}

export async function heartbeatPrintAgent(
  supabase: SupabaseClient,
  agent: PrintAgentContext,
  printers: string[]
) {
  await recoverStalePrintJobs(supabase, agent.organizationId);
  const names = printers.map((name) => name.trim()).filter(Boolean);
  const { error } = await supabase
    .from("print_agents")
    .update({
      last_seen_at: new Date().toISOString(),
      printers: names,
    })
    .eq("id", agent.agentId)
    .eq("organization_id", agent.organizationId);
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
  const station = await getPrintStation(supabase, agent.organizationId);
  return {
    connected: station.connected,
    selectedPrinterName: station.selectedPrinterName,
    paperSize: station.paperSize,
    orientation: station.orientation,
    copies: station.copies,
  };
}

export async function recoverStalePrintJobs(supabase: SupabaseClient, organizationId: string) {
  const cutoff = new Date(Date.now() - PRINTING_STALE_MS).toISOString();
  await supabase
    .from("print_jobs")
    .update({
      status: "NEEDS_REVIEW",
      error_message: STALE_PRINT_REVIEW_MESSAGE,
    })
    .eq("organization_id", organizationId)
    .eq("status", "PRINTING")
    .lt("claimed_at", cutoff);
}

export async function enqueueAutoPrintJob(
  supabase: SupabaseClient,
  input: { organizationId: string; shipmentId: string; labelId: string; paperSize?: string; copies?: number }
): Promise<PrintJobRow> {
  const { data: existing } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("label_id", input.labelId)
    .eq("source", "AUTO")
    .maybeSingle();
  if (existing) return existing as PrintJobRow;

  const settings = await getPrintSettings(supabase, input.organizationId);
  const target = await printTarget(supabase, input.organizationId, settings, { requireDevice: true });
  const insert = {
    organization_id: input.organizationId,
    shipment_id: input.shipmentId,
    label_id: input.labelId,
    printer_name: target.printerName,
    source: "AUTO" as const,
    status: "PENDING" as const,
    paper_size: input.paperSize || settings.paperSize,
    copies: input.copies || settings.copies,
    delivery: target.delivery,
    device_id: target.deviceId,
  };
  const { data, error } = await supabase.from("print_jobs").insert(insert).select("*").single();
  if (data) return data as PrintJobRow;
  if (uniqueViolation(error)) {
    const { data: again } = await supabase
      .from("print_jobs")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("label_id", input.labelId)
      .eq("source", "AUTO")
      .maybeSingle();
    if (again) return again as PrintJobRow;
  }
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not create a print job.");
}

export async function enqueueManualPrintJob(
  supabase: SupabaseClient,
  ctx: TenantContext,
  labelId: string,
  options?: {
    paperSize?: string;
    copies?: number;
    idempotencyKey?: string | null;
    deviceId?: string | null;
    printerName?: string | null;
  }
): Promise<PrintJobRow> {
  const { data: label } = await supabase
    .from("labels")
    .select("id, shipment_id, status, kind")
    .eq("organization_id", ctx.organizationId)
    .eq("id", labelId)
    .maybeSingle();
  if (!label) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Label not found.");
  }
  if (String(label.status).toUpperCase() !== "READY") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "The label PDF is not ready to print yet.");
  }
  const settings = await getPrintSettings(supabase, ctx.organizationId);
  const target = await printTarget(supabase, ctx.organizationId, settings, { requireDevice: true });
  const deviceId = options?.deviceId !== undefined ? options.deviceId : target.deviceId;
  const printerName = options?.printerName !== undefined ? options.printerName : target.printerName;
  const paperSize = options?.paperSize || paperSizeForLabelKind(label.kind);
  if (paperSize && !isPrintPaperSize(paperSize)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Paper size must be A6, 4x6, A5, A4, or A3.");
  }
  const copies = options?.copies ?? settings.copies;
  const { data, error } = await supabase
    .from("print_jobs")
    .insert({
      organization_id: ctx.organizationId,
      shipment_id: label.shipment_id,
      label_id: label.id,
      printer_name: printerName,
      source: "MANUAL",
      status: "PENDING",
      paper_size: paperSize,
      copies,
      delivery: target.delivery,
      device_id: deviceId,
      idempotency_key: options?.idempotencyKey || null,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not queue a reprint.");
  }
  return data as PrintJobRow;
}

export async function claimNextPrintJob(
  supabase: SupabaseClient,
  agent: PrintAgentContext,
  options?: { printers?: string[]; source?: PrintClaimSource }
) {
  await recoverStalePrintJobs(supabase, agent.organizationId);
  const settings = await getPrintSettings(supabase, agent.organizationId);
  const source: PrintClaimSource = options?.source ?? "legacy";
  let printers = options?.printers?.map((name) => name.trim()).filter(Boolean) ?? [];
  if (printers.length === 0 && source !== "device") {
    const { data: agentRow } = await supabase
      .from("print_agents")
      .select("printers")
      .eq("id", agent.agentId)
      .maybeSingle();
    printers = asPrinterList(agentRow?.printers);
  }
  if (printers.length === 0) return null;

  const targetPrinter = settings.selectedPrinterName;
  if (targetPrinter && !printers.includes(targetPrinter) && source !== "device") return null;
  if (source === "device" && targetPrinter && settings.selectedDeviceId === agent.agentId && !printers.includes(targetPrinter)) {
    return null;
  }

  const { data: jobs, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("organization_id", agent.organizationId)
    .eq("status", "PENDING")
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }

  for (const job of (jobs ?? []) as PrintJobRow[]) {
    if (jobDelivery(job) === "webusb") continue;
    if (source === "device") {
      if (job.device_id !== agent.agentId) continue;
    } else if (job.device_id) {
      continue;
    }
    const printerName =
      job.printer_name && printers.includes(job.printer_name) ? job.printer_name : targetPrinter;
    if (!printerName || !printers.includes(printerName)) continue;

    const claimId = randomUUID();
    const { data: claimed } = await supabase
      .from("print_jobs")
      .update({
        status: "PRINTING",
        claimed_at: new Date().toISOString(),
        printer_name: printerName,
        error_message: null,
        claimed_by_device_id: source === "device" ? agent.agentId : null,
        claim_id: claimId,
      })
      .eq("id", job.id)
      .eq("organization_id", agent.organizationId)
      .eq("status", "PENDING")
      .select("*")
      .maybeSingle();
    if (!claimed) continue;

    const { data: labelFile } = await supabase
      .from("labels")
      .select("kind, template_snapshot")
      .eq("organization_id", agent.organizationId)
      .eq("id", claimed.label_id)
      .maybeSingle();
    const snapshot = labelFile?.template_snapshot as { page?: { widthPt?: number; heightPt?: number; widthMm?: number; heightMm?: number } } | null;
    const page = snapshot?.page;
    const customPage =
      String(labelFile?.kind || "").toUpperCase() === "CUSTOM_SHIPPING" &&
      page &&
      Number(page.widthPt) > 0 &&
      Number(page.heightPt) > 0
        ? printMediaForPage({
            widthPt: Number(page.widthPt),
            heightPt: Number(page.heightPt),
            widthMm: page.widthMm,
            heightMm: page.heightMm,
          })
        : null;

    return {
      job: mapPrintJob(claimed as PrintJobRow),
      paperSize: customPage?.paperSize || agentPaperSize(claimed.paper_size || settings.paperSize),
      orientation: customPage?.orientation || "portrait",
      copies: Number(claimed.copies) || settings.copies,
      widthMm: customPage ? mmFromPt(Number(page?.widthPt)) : undefined,
      heightMm: customPage ? mmFromPt(Number(page?.heightPt)) : undefined,
    };
  }
  return null;
}

function assertClaimOwner(job: PrintJobRow, agent: PrintAgentContext, source: PrintClaimSource) {
  if (source === "webusb") return;
  if (source === "device") {
    if (job.device_id && job.device_id !== agent.agentId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "This print job belongs to another Print Agent.");
    }
    if (job.claimed_by_device_id && job.claimed_by_device_id !== agent.agentId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "This print job belongs to another Print Agent.");
    }
    if (!job.device_id && !job.claimed_by_device_id) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "This print job is queued for the legacy print agent.");
    }
    return;
  }
  if (job.device_id || job.claimed_by_device_id) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "This print job belongs to a paired Print Agent.");
  }
}

export async function completePrintJob(
  supabase: SupabaseClient,
  agent: PrintAgentContext,
  jobId: string,
  result: { status: "PRINTED" | "FAILED" | "PENDING"; errorMessage?: string | null },
  options?: { delivery?: PrintDelivery; source?: PrintClaimSource }
) {
  const { data: job } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("organization_id", agent.organizationId)
    .maybeSingle();
  if (!job) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Print job not found.");
  }
  const row = job as PrintJobRow;
  const source: PrintClaimSource = options?.source ?? "legacy";
  const expectedDelivery = options?.delivery ?? "agent";
  if (jobDelivery(row) !== expectedDelivery) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      expectedDelivery === "webusb"
        ? "This label is queued for the print agent."
        : "This label is queued for direct USB printing."
    );
  }
  assertClaimOwner(row, agent, source);
  if (row.status === "PRINTED") return mapPrintJob(row);
  const lateAck = row.status === "NEEDS_REVIEW" && result.status === "PRINTED";
  if (row.status !== "PRINTING" && row.status !== "PENDING" && !lateAck) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This print job can no longer be updated.");
  }
  if (lateAck) {
    const sameDevice = Boolean(row.claimed_by_device_id) && row.claimed_by_device_id === agent.agentId;
    const sameClaim = Boolean(row.claim_id) && row.claimed_by_device_id === agent.agentId;
    if (source === "device" && !sameDevice && !sameClaim) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "This print job belongs to another Print Agent.");
    }
  }

  if (result.status === "PENDING") {
    if (row.status !== "PRINTING" && row.status !== "PENDING") {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This print job can no longer be updated.");
    }
    const { data, error } = await supabase
      .from("print_jobs")
      .update({
        status: "PENDING",
        claimed_at: null,
        claimed_by_device_id: null,
        claim_id: null,
        error_message:
          result.errorMessage?.trim() ||
          "Printer unavailable. Label will print when the printer reconnects.",
      })
      .eq("id", jobId)
      .eq("organization_id", agent.organizationId)
      .select("*")
      .single();
    if (error || !data) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not update the print job.");
    }
    return mapPrintJob(data as PrintJobRow);
  }

  const printed = result.status === "PRINTED";
  const { data, error } = await supabase
    .from("print_jobs")
    .update({
      status: result.status,
      printed_at: printed ? new Date().toISOString() : null,
      error_message: printed
        ? null
        : result.errorMessage?.trim() || "The printer could not print this label.",
    })
    .eq("id", jobId)
    .eq("organization_id", agent.organizationId)
    .select("*")
    .single();
  if (error || !data) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not update the print job.");
  }
  return mapPrintJob(data as PrintJobRow);
}

export async function loadPrintJobPdf(
  supabase: SupabaseClient,
  agent: PrintAgentContext,
  jobId: string,
  options?: { delivery?: PrintDelivery; source?: PrintClaimSource }
): Promise<{ bytes: Buffer; filename: string; job: PrintJobRow }> {
  const { data: job } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("organization_id", agent.organizationId)
    .maybeSingle();
  if (!job) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Print job not found.");
  }
  if (job.organization_id !== agent.organizationId) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "You do not have access to this label.");
  }
  const expectedDelivery = options?.delivery ?? "agent";
  if (jobDelivery(job as PrintJobRow) !== expectedDelivery) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "You do not have access to this label.");
  }
  assertClaimOwner(job as PrintJobRow, agent, options?.source ?? "legacy");

  const { data: label } = await supabase
    .from("labels")
    .select("id, file_path, file_url, shipment_id, organization_id")
    .eq("id", job.label_id)
    .eq("organization_id", agent.organizationId)
    .maybeSingle();
  if (!label?.file_path && !label?.file_url) {
    await supabase
      .from("print_jobs")
      .update({
        status: "FAILED",
        error_message: "PDF unavailable",
      })
      .eq("id", job.id)
      .eq("organization_id", agent.organizationId);
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "The label PDF is not available to print.");
  }

  try {
    const bytes = await loadLabelPdfBytes(supabase, agent.organizationId, {
      id: String(label.id),
      file_path: label.file_path || "",
      file_url: label.file_url,
      shipment_id: label.shipment_id ?? job.shipment_id,
    });
    return { bytes, filename: `${job.shipment_id}.pdf`, job: job as PrintJobRow };
  } catch {
    await supabase
      .from("print_jobs")
      .update({
        status: "FAILED",
        error_message: "PDF unavailable",
      })
      .eq("id", job.id)
      .eq("organization_id", agent.organizationId);
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "The label PDF is not available to print.");
  }
}

export async function listPendingWebusbJobs(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("print_jobs")
    .select("id, status, source, printer_name, created_at, delivery, copies")
    .eq("organization_id", organizationId)
    .eq("status", "PENDING")
    .eq("delivery", "webusb")
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not load print jobs.");
  }
  return ((data ?? []) as PrintJobRow[]).map((row) => ({
    id: row.id,
    status: row.status,
    source: row.source,
    printerName: row.printer_name,
    createdAt: row.created_at,
    copies: Number(row.copies) || 1,
  }));
}

export async function claimWebusbPrintJob(supabase: SupabaseClient, ctx: TenantContext, jobId: string) {
  const { data: job, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Could not load the print job.");
  }
  if (!job) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Print job not found.");
  }
  if (jobDelivery(job as PrintJobRow) !== "webusb") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This label is queued for the print agent.");
  }
  if (job.status !== "PENDING") {
    throw new AppError(ERROR_CODES.CONFLICT, "This label is already printing.");
  }

  const { data: claimed } = await supabase
    .from("print_jobs")
    .update({
      status: "PRINTING",
      claimed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", jobId)
    .eq("organization_id", ctx.organizationId)
    .eq("status", "PENDING")
    .select("*")
    .maybeSingle();
  if (!claimed) {
    throw new AppError(ERROR_CODES.CONFLICT, "This label is already printing.");
  }

  logInfo("print.requested", { organizationId: ctx.organizationId, jobId });
  const loaded = await loadPrintJobPdf(
    supabase,
    { agentId: "webusb", organizationId: ctx.organizationId },
    jobId,
    { delivery: "webusb" }
  );
  return {
    job: mapPrintJob(claimed as PrintJobRow),
    copies: Number(claimed.copies) || 1,
    pdfBase64: loaded.bytes.toString("base64"),
    filename: loaded.filename,
  };
}

export async function completeWebusbPrintJob(
  supabase: SupabaseClient,
  ctx: TenantContext,
  jobId: string,
  result: { status: "PRINTED" | "FAILED" | "PENDING"; errorMessage?: string | null }
) {
  const job = await completePrintJob(
    supabase,
    { agentId: "webusb", organizationId: ctx.organizationId },
    jobId,
    result,
    { delivery: "webusb" }
  );
  const event =
    result.status === "PRINTED" ? "print.succeeded" : result.status === "FAILED" ? "print.failed" : "print.requested";
  logInfo(event, { organizationId: ctx.organizationId, jobId, delivery: "webusb" });
  return job;
}

export async function reprintPrintJob(
  supabase: SupabaseClient,
  ctx: TenantContext,
  jobId: string,
  options?: { idempotencyKey?: string | null }
) {
  const { data: job } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (!job) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Print job not found.");
  const row = job as PrintJobRow;
  if (row.status !== "NEEDS_REVIEW" && row.status !== "FAILED") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Only failed or unverified jobs can be reprinted.");
  }
  const reprinted = await enqueueManualPrintJob(supabase, ctx, row.label_id, {
    paperSize: row.paper_size || undefined,
    copies: Number(row.copies) || 1,
    idempotencyKey: options?.idempotencyKey,
  });
  await supabase
    .from("print_jobs")
    .update({ reprinted_from_job_id: row.id })
    .eq("id", reprinted.id)
    .eq("organization_id", ctx.organizationId);
  reprinted.reprinted_from_job_id = row.id;
  await supabase.from("audit_logs").insert({
    organization_id: ctx.organizationId,
    actor_id: ctx.userId,
    action: "print_job.reprinted",
    entity_type: "print_job",
    entity_id: reprinted.id,
    after: { fromJobId: row.id, labelId: row.label_id },
  });
  return reprinted;
}

export function latestPrintJob(jobs: { created_at?: string; createdAt?: string }[] | null | undefined) {
  if (!jobs?.length) return null;
  return [...jobs].sort((left, right) => {
    const a = new Date(left.created_at ?? left.createdAt ?? 0).getTime();
    const b = new Date(right.created_at ?? right.createdAt ?? 0).getTime();
    return b - a;
  })[0];
}

export function isPrintAgentApiPath(path: string) {
  return (
    path === "print-agent/heartbeat" ||
    path === "print-agent/jobs/claim" ||
    /^print-jobs\/[^/]+(\/pdf)?$/.test(path)
  );
}
