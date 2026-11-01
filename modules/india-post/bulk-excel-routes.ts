import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  confirmImportBatch,
  createImportBatch,
  excelTemplateBytes,
  getImportBatch,
  importErrorWorkbook,
  importProgress,
  listMappingProfiles,
  patchImportRow,
  retryImportFailures,
  saveImportDraft,
  saveMappingProfile,
  updateImportMapping,
  validateImportBatch,
} from "@/modules/india-post/bulk-excel-import";

function xlsx(bytes: Uint8Array, filename: string) {
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function handleBulkExcelRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  method: string,
  slugs: string[]
) {
  if (slugs[0] !== "bookings") return null;
  if (method === "GET" && slugs[1] === "excel-template") {
    return xlsx(await excelTemplateBytes(), "postbus-bulk-booking.xlsx");
  }
  if (method === "GET" && slugs[1] === "excel-import-profiles") {
    return listMappingProfiles(supabase, ctx);
  }
  if (method === "POST" && slugs[1] === "excel-import-profiles") {
    const body = (await request.json()) as { name?: string; format?: string; columnMap?: Record<string, string> };
    return saveMappingProfile(supabase, ctx, {
      name: body.name ?? "",
      format: body.format ?? "",
      columnMap: body.columnMap ?? {},
    });
  }
  if (slugs[1] !== "excel-imports") return null;

  if (method === "POST" && slugs.length === 2) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Upload an Excel workbook.");
    const profileId = String(form.get("profileId") ?? "");
    return createImportBatch(supabase, ctx, await file.arrayBuffer(), file.name, profileId || undefined);
  }

  const batchId = slugs[2];
  if (!batchId) return null;

  if (method === "GET" && slugs.length === 3) return getImportBatch(supabase, ctx, batchId);
  if (method === "GET" && slugs[3] === "progress") return importProgress(supabase, ctx, batchId);
  if (method === "GET" && slugs[3] === "errors") {
    return xlsx(await importErrorWorkbook(supabase, ctx, batchId), "bulk-excel-errors.xlsx");
  }
  if (method === "PATCH" && slugs.length === 3) {
    const body = (await request.json()) as {
      columnMap?: Record<string, string>;
      serviceCode?: string;
      profile?: string;
    };
    return updateImportMapping(supabase, ctx, batchId, {
      columnMap: body.columnMap ?? {},
      serviceCode: body.serviceCode,
      profile: body.profile,
    });
  }
  if (method === "POST" && slugs[3] === "validate") return validateImportBatch(supabase, ctx, batchId);
  if (method === "POST" && slugs[3] === "draft") return saveImportDraft(supabase, ctx, batchId);
  if (method === "POST" && slugs[3] === "confirm") return confirmImportBatch(supabase, ctx, batchId);
  if (method === "POST" && slugs[3] === "retry") return retryImportFailures(supabase, ctx, batchId);
  if (method === "PATCH" && slugs[3] === "rows" && slugs[4]) {
    const body = (await request.json()) as { fields?: Record<string, string> };
    return patchImportRow(supabase, ctx, batchId, slugs[4], body.fields ?? {});
  }
  return null;
}
