import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { logError, logInfo } from "@/lib/logger";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function relativeLabelPath(organizationId: string, shipmentId: string) {
  if (!UUID.test(organizationId) || !UUID.test(shipmentId)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Invalid label path.");
  }
  return `${organizationId}/${shipmentId}.pdf`;
}

export function labelStorageRoot(root = env.labelStoragePath) {
  return path.resolve(root);
}

function isInsideRoot(resolved: string, root: string) {
  const base = path.resolve(root);
  const target = path.resolve(resolved);
  if (process.platform === "win32") {
    const left = base.toLowerCase();
    const right = target.toLowerCase();
    return right === left || right.startsWith(left + path.sep);
  }
  return target === base || target.startsWith(base + path.sep);
}

export function resolveSafeLabelPath(
  relativePath: string,
  organizationId?: string,
  root = env.labelStoragePath
) {
  const trimmed = relativePath?.trim() ?? "";
  if (!trimmed || trimmed.includes("\0")) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Invalid label path.");
  }
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\")) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Invalid label path.");
  }
  const posix = trimmed.replace(/\\/g, "/");
  if (posix.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Invalid label path.");
  }
  const [folder, file] = posix.split("/");
  if (!folder || !file || posix.split("/").length !== 2 || !file.endsWith(".pdf")) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Invalid label path.");
  }
  if (organizationId && folder !== organizationId) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "You do not have access to this label.");
  }

  const base = labelStorageRoot(root);
  const resolved = path.resolve(base, posix);
  if (!isInsideRoot(resolved, base) || resolved === base) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Invalid label path.");
  }
  return resolved;
}

export async function saveLabelPdf(input: {
  organizationId: string;
  shipmentId: string;
  bytes: Buffer | Uint8Array;
  root?: string;
}) {
  const relative = relativeLabelPath(input.organizationId, input.shipmentId);
  const absolute = resolveSafeLabelPath(relative, input.organizationId, input.root);
  try {
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, input.bytes);
  } catch (error) {
    logError("LABEL_WRITE_FAILED", {
      organizationId: input.organizationId,
      shipmentId: input.shipmentId,
      filePath: relative,
      message: error instanceof Error ? error.message : "unknown",
    });
    throw Object.assign(
      new Error(error instanceof Error ? error.message : "Could not save the shipping label."),
      { code: "LABEL_GENERATION_FAILED" }
    );
  }
  logInfo("LABEL_SAVED", {
    organizationId: input.organizationId,
    shipmentId: input.shipmentId,
    filePath: relative,
  });
  return relative;
}

export async function readLabelPdfIfPresent(input: {
  relativePath: string;
  organizationId: string;
  labelId?: string;
  shipmentId?: string;
  root?: string;
}) {
  let absolute: string;
  try {
    absolute = resolveSafeLabelPath(input.relativePath, input.organizationId, input.root);
  } catch (error) {
    logError("LABEL_READ_FAILED", {
      organizationId: input.organizationId,
      shipmentId: input.shipmentId,
      labelId: input.labelId,
      filePath: input.relativePath,
      message: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }

  try {
    const bytes = await readFile(absolute);
    logInfo("LABEL_READ", {
      organizationId: input.organizationId,
      shipmentId: input.shipmentId,
      labelId: input.labelId,
      filePath: input.relativePath,
    });
    return bytes;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      logInfo("LABEL_NOT_FOUND", {
        organizationId: input.organizationId,
        shipmentId: input.shipmentId,
        labelId: input.labelId,
        filePath: input.relativePath,
      });
      return null;
    }
    logError("LABEL_READ_FAILED", {
      organizationId: input.organizationId,
      shipmentId: input.shipmentId,
      labelId: input.labelId,
      filePath: input.relativePath,
      message: error instanceof Error ? error.message : "unknown",
    });
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not read the shipping label.");
  }
}
