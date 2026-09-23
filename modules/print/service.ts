import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { hashSecret, randomToken, safeEqual } from "@/lib/security/crypto";
import { readLabelPdfIfPresent } from "@/modules/labels/storage";

export const PRINT_AGENT_ONLINE_MS = 30_000;
export const PRINTING_STALE_MS = 120_000;

export const PRINT_DEFAULTS = {
  paperSize: "A6" as const,
  orientation: "portrait" as const,
  copies: 1,
};

export type PrintJobStatus = "PENDING" | "PRINTING" | "PRINTED" | "FAILED";
export type PrintJobSource = "AUTO" | "MANUAL";

export type PrintSettings = {
  organizationId: string;
  selectedPrinterName: string | null;
  paperSize: string;
  orientation: string;
  copies: number;
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
};

export type PrintStation = {
  selectedPrinterName: string | null;
  paperSize: string;
  orientation: string;
  copies: number;
  connected: boolean;
  printerNames: string[];
  agentName: string | null;
  tokenPrefix: string | null;
  lastSeenAt: string | null;
  offlineMessage: string | null;
};

export type PrintAgentContext = {
  agentId: string;
  organizationId: string;
};

function asPrinterList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
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
  paper_size?: string | null;
  orientation?: string | null;
  copies?: number | null;
}): PrintSettings {
  return {
    organizationId: row.organization_id,
    selectedPrinterName: row.selected_printer_name?.trim() || null,
    paperSize: row.paper_size || PRINT_DEFAULTS.paperSize,
    orientation: row.orientation || PRINT_DEFAULTS.orientation,
    copies: Number(row.copies) || PRINT_DEFAULTS.copies,
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
  if (status === "PENDING" || status === "PRINTING") return "WAITING";
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
    paperSize?: string;
    orientation?: string;
    copies?: number;
  }
): Promise<PrintSettings> {
  await getPrintSettings(supabase, ctx.organizationId);
  const updates: Record<string, unknown> = {};
  if (patch.selectedPrinterName !== undefined) {
    updates.selected_printer_name = patch.selectedPrinterName?.trim() || null;
  }
  if (patch.paperSize !== undefined) {
    if (!["A6", "A5", "A4"].includes(patch.paperSize)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Paper size must be A6, A5, or A4.");
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

  const printerNames = asPrinterList(agent?.printers);
  const connected = isPrintAgentOnline(agent?.last_seen_at) && printerNames.length > 0;
  const selected = settings.selectedPrinterName;
  const selectedOnline = Boolean(selected && printerNames.includes(selected));
  let offlineMessage: string | null = null;
  if (!agent?.token_prefix) {
    offlineMessage = "Install the PostBus print agent on the packing computer, then connect it here.";
  } else if (!isPrintAgentOnline(agent.last_seen_at)) {
    offlineMessage =
      "No printer detected. Start the print agent on the packing computer. Labels will print when it reconnects.";
  } else if (printerNames.length === 0) {
    offlineMessage = "The print agent is online, but no printers were reported. Check the computer's printers.";
  } else if (selected && !selectedOnline) {
    offlineMessage = `Printer unavailable (${selected}). Label jobs stay waiting until that printer reconnects.`;
  }

  return {
    selectedPrinterName: selected,
    paperSize: settings.paperSize,
    orientation: settings.orientation,
    copies: settings.copies,
    connected: connected && (!selected || selectedOnline),
    printerNames,
    agentName: agent?.name ?? null,
    tokenPrefix: agent?.token_prefix ?? null,
    lastSeenAt: agent?.last_seen_at ?? null,
    offlineMessage,
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
      status: "PENDING",
      claimed_at: null,
      error_message: "Printer timed out. The label will print when the agent reconnects.",
    })
    .eq("organization_id", organizationId)
    .eq("status", "PRINTING")
    .lt("claimed_at", cutoff);
}

export async function enqueueAutoPrintJob(
  supabase: SupabaseClient,
  input: { organizationId: string; shipmentId: string; labelId: string }
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
  const insert = {
    organization_id: input.organizationId,
    shipment_id: input.shipmentId,
    label_id: input.labelId,
    printer_name: settings.selectedPrinterName,
    source: "AUTO" as const,
    status: "PENDING" as const,
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
  labelId: string
): Promise<PrintJobRow> {
  const { data: label } = await supabase
    .from("labels")
    .select("id, shipment_id, status")
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
  const { data, error } = await supabase
    .from("print_jobs")
    .insert({
      organization_id: ctx.organizationId,
      shipment_id: label.shipment_id,
      label_id: label.id,
      printer_name: settings.selectedPrinterName,
      source: "MANUAL",
      status: "PENDING",
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error?.message || "Could not queue a reprint.");
  }
  return data as PrintJobRow;
}

export async function claimNextPrintJob(supabase: SupabaseClient, agent: PrintAgentContext) {
  await recoverStalePrintJobs(supabase, agent.organizationId);
  const settings = await getPrintSettings(supabase, agent.organizationId);
  const { data: agentRow } = await supabase
    .from("print_agents")
    .select("printers")
    .eq("id", agent.agentId)
    .maybeSingle();
  const printers = asPrinterList(agentRow?.printers);
  if (printers.length === 0) return null;

  const targetPrinter = settings.selectedPrinterName;
  if (targetPrinter && !printers.includes(targetPrinter)) return null;

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
    const printerName =
      job.printer_name && printers.includes(job.printer_name) ? job.printer_name : targetPrinter;
    if (!printerName || !printers.includes(printerName)) continue;

    const { data: claimed } = await supabase
      .from("print_jobs")
      .update({
        status: "PRINTING",
        claimed_at: new Date().toISOString(),
        printer_name: printerName,
        error_message: null,
      })
      .eq("id", job.id)
      .eq("organization_id", agent.organizationId)
      .eq("status", "PENDING")
      .select("*")
      .maybeSingle();
    if (!claimed) continue;

    return {
      job: mapPrintJob(claimed as PrintJobRow),
      paperSize: settings.paperSize,
      orientation: settings.orientation,
      copies: settings.copies,
    };
  }
  return null;
}

export async function completePrintJob(
  supabase: SupabaseClient,
  agent: PrintAgentContext,
  jobId: string,
  result: { status: "PRINTED" | "FAILED" | "PENDING"; errorMessage?: string | null }
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
  if (job.status === "PRINTED") return mapPrintJob(job as PrintJobRow);
  if (job.status !== "PRINTING" && job.status !== "PENDING") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This print job can no longer be updated.");
  }

  if (result.status === "PENDING") {
    const { data, error } = await supabase
      .from("print_jobs")
      .update({
        status: "PENDING",
        claimed_at: null,
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
  jobId: string
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

  const { data: label } = await supabase
    .from("labels")
    .select("id, file_path, shipment_id, organization_id")
    .eq("id", job.label_id)
    .eq("organization_id", agent.organizationId)
    .maybeSingle();
  if (!label?.file_path) {
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

  const fromDisk = await readLabelPdfIfPresent({
    relativePath: label.file_path,
    organizationId: agent.organizationId,
    labelId: label.id,
    shipmentId: label.shipment_id ?? job.shipment_id,
  });
  if (fromDisk) {
    return { bytes: fromDisk, filename: `${job.shipment_id}.pdf`, job: job as PrintJobRow };
  }

  const file = await supabase.storage.from("labels").download(label.file_path);
  if (file.data) {
    return {
      bytes: Buffer.from(await file.data.arrayBuffer()),
      filename: `${job.shipment_id}.pdf`,
      job: job as PrintJobRow,
    };
  }

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
