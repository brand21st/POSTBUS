import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { rateLimit } from "@/lib/security/rate-limit";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import {
  approveDevicePairing,
  authenticatePrintDevice,
  disconnectCurrentDevice,
  exchangeDevicePairing,
  heartbeatPrintDevice,
  listPrintDevices,
  pollDevicePairing,
  refreshPrintDevice,
  revokePrintDevice,
  startDevicePairing,
} from "@/modules/print/device-pairing-db";
import { claimNextPrintJob, completePrintJob, loadPrintJobPdf } from "@/modules/print/service";

const PUBLIC_PATHS = new Set([
  "print-devices/pair/start",
  "print-devices/pair/poll",
  "print-devices/pair/exchange",
  "print-devices/heartbeat",
  "print-devices/refresh",
  "print-devices/disconnect",
]);

export function isPrintDevicePublicPath(path: string) {
  return PUBLIC_PATHS.has(path) || /^print-devices\/jobs\/(claim|[^/]+(\/pdf)?)$/.test(path);
}

function admin() {
  if (!hasAdminClient()) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Device pairing is not enabled on this server.");
  }
  return createAdminClient();
}

function clientAddress(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function handlePrintDevicePublicRoutes(request: NextRequest, path: string) {
  const supabase = admin();
  const jobPath = path.startsWith("print-devices/jobs") || path === "print-devices/heartbeat" || path === "print-devices/refresh";
  const limited = rateLimit(
    `print-device:${clientAddress(request)}:${path}`,
    path.endsWith("start") ? 8 : jobPath ? 180 : 30,
    jobPath ? 60_000 : 10 * 60 * 1000
  );
  if (!limited.ok) throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");

  if (path === "print-devices/jobs/claim" && request.method === "POST") {
    const device = await authenticatePrintDevice(supabase, request.headers.get("authorization"));
    return claimNextPrintJob(supabase, device, { printers: device.printers });
  }
  const jobMatch = path.match(/^print-devices\/jobs\/([^/]+)(\/pdf)?$/);
  if (jobMatch) {
    const device = await authenticatePrintDevice(supabase, request.headers.get("authorization"));
    const jobId = jobMatch[1];
    if (jobMatch[2] && request.method === "GET") {
      const { bytes, filename } = await loadPrintJobPdf(supabase, device, jobId);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
        },
      });
    }
    if (!jobMatch[2] && request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
        errorMessage?: string;
      };
      if (body.status !== "PRINTED" && body.status !== "FAILED" && body.status !== "PENDING") {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Print status must be PRINTED, FAILED, or PENDING.");
      }
      return completePrintJob(supabase, device, jobId, {
        status: body.status,
        errorMessage: body.errorMessage ?? body.error,
      });
    }
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
  }

  if (request.method !== "POST") throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (path === "print-devices/pair/start") {
    const data = await startDevicePairing(supabase, {
      verifier: String(body.verifier ?? ""),
      deviceName: String(body.deviceName ?? body.device_name ?? ""),
      platform: String(body.platform ?? "windows"),
      osVersion: String(body.osVersion ?? body.os_version ?? ""),
      agentVersion: String(body.agentVersion ?? body.agent_version ?? ""),
    });
    return ok(data);
  }
  if (path === "print-devices/pair/poll") {
    return ok(await pollDevicePairing(supabase, String(body.verifier ?? "")));
  }
  if (path === "print-devices/pair/exchange") {
    return ok(await exchangeDevicePairing(supabase, String(body.verifier ?? "")));
  }
  if (path === "print-devices/heartbeat") {
    const header = request.headers.get("authorization") ?? "";
    const accessToken = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : String(body.accessToken ?? "");
    return ok(
      await heartbeatPrintDevice(supabase, {
        accessToken,
        agentVersion: typeof body.agentVersion === "string" ? body.agentVersion : undefined,
        printers: Array.isArray(body.printers) ? body.printers : undefined,
        selectedPrinter: typeof body.selectedPrinter === "string" ? body.selectedPrinter : undefined,
      })
    );
  }
  if (path === "print-devices/disconnect") {
    const header = request.headers.get("authorization") ?? "";
    const accessToken = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : "";
    return ok(await disconnectCurrentDevice(supabase, accessToken));
  }
  if (path === "print-devices/refresh") {
    const header = request.headers.get("authorization") ?? "";
    const refreshToken = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : String(body.refreshToken ?? "");
    return ok(await refreshPrintDevice(supabase, refreshToken));
  }
  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}

export async function handlePrintDeviceTenantRoutes(
  request: NextRequest,
  _supabase: unknown,
  ctx: TenantContext,
  method: string,
  slugs: string[]
) {
  if (slugs[0] !== "print-devices") return null;
  const supabase = admin();
  if (method === "GET" && slugs.length === 1) {
    return ok(await listPrintDevices(supabase, ctx.organizationId));
  }
  if (method === "POST" && slugs[1] === "pair" && slugs[2] === "approve") {
    const body = (await request.json().catch(() => ({}))) as { code?: string };
    const limited = rateLimit(`print-device-approve:${ctx.userId}`, 20, 10 * 60 * 1000);
    if (!limited.ok) throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
    return ok(
      await approveDevicePairing(supabase, {
        code: String(body.code ?? ""),
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        organizationName: ctx.organizationName,
      })
    );
  }
  if (method === "POST" && slugs[1] && slugs[2] === "revoke") {
    return ok(await revokePrintDevice(supabase, { organizationId: ctx.organizationId, deviceId: slugs[1], userId: ctx.userId }));
  }
  return null;
}
