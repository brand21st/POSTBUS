import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { formFile, jsonBody, uuidParam, type AccountantRoute } from "@/lib/api/v1/ai-accountant/shared";
import { columnMapSchema, ingestCodReport, listCodReports, previewCodReport, resolveReconciliation } from "@/modules/ai-accountant/cod/ingest";

function columnMapFrom(form: FormData) {
  const raw = form.get("columnMap");
  if (typeof raw !== "string" || !raw) return null;
  try {
    return columnMapSchema.parse(JSON.parse(raw));
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Column mapping is invalid.");
  }
}

/** COD remittance report upload, preview, review queue and manual resolution. */
export async function handleCodRoutes({ request, admin, ctx, key, slugs }: AccountantRoute) {
  const org = ctx.organizationId;
  if (key === "GET ai-accountant/cod") return listCodReports(admin, org, request.nextUrl.searchParams.get("status"));
  if (key === "POST ai-accountant/cod/preview") {
    const { file, form } = await formFile(request);
    return previewCodReport(file, columnMapFrom(form));
  }
  if (key === "POST ai-accountant/cod") {
    const { file, form } = await formFile(request);
    return ingestCodReport(admin, { organizationId: org, userId: ctx.userId, file, columnMap: columnMapFrom(form) });
  }
  if (slugs[1] === "cod" && slugs[2] === "reconciliations" && slugs[4] === "resolve" && key.startsWith("POST ")) {
    return resolveReconciliation(admin, org, uuidParam(slugs[3]), await jsonBody(request), ctx.userId);
  }
  return null;
}
