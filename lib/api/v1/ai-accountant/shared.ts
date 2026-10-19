import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { AddonAccessMode } from "@/modules/addons/constants";
import { resolvePeriod } from "@/modules/ai-accountant/period";

export type AccountantRoute = {
  request: NextRequest;
  /** Service-role client. Every query must filter by ctx.organizationId. */
  admin: SupabaseClient;
  ctx: TenantContext;
  key: string;
  method: string;
  /** ["ai-accountant", ...rest] */
  slugs: string[];
  accessMode: AddonAccessMode;
};

export function periodFrom(request: NextRequest) {
  try {
    return resolvePeriod({
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to"),
    });
  } catch (error) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error instanceof Error ? error.message : "Invalid period.");
  }
}

export function uuidParam(value: string | undefined, label = "Id") {
  if (!value || !z.string().uuid().safeParse(value).success) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${label} is invalid.`);
  }
  return value;
}

export async function jsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Request body must be JSON.");
  }
}

export async function formFile(request: NextRequest, field = "file") {
  const form = await request.formData().catch(() => null);
  const file = form?.get(field);
  if (!(file instanceof File) || file.size === 0) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Attach a file.");
  return { file, form: form! };
}
