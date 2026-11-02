import { jsonBody, uuidParam, type AccountantRoute } from "@/lib/api/v1/ai-accountant/shared";
import { createExport, exportDownloadUrl, listExports } from "@/modules/ai-accountant/exports/run";

export async function handleExportRoutes({ request, admin, ctx, key, slugs }: AccountantRoute) {
  const org = ctx.organizationId;
  if (key === "GET ai-accountant/exports") return listExports(admin, org);
  if (key === "POST ai-accountant/exports") return createExport(admin, org, await jsonBody(request), ctx.userId);
  if (slugs[1] === "exports" && slugs[3] === "download" && key.startsWith("GET ")) {
    return exportDownloadUrl(admin, org, uuidParam(slugs[2]));
  }
  return null;
}
