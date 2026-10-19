import { z } from "zod";
import { jsonBody, type AccountantRoute } from "@/lib/api/v1/ai-accountant/shared";
import { importTaxProfilesCsv, listGstDrafts, listTaxProfiles, prepareGstReturn, saveTaxProfile } from "@/modules/ai-accountant/gst-service";

/** Product HSN/rate profiles and GSTR-1/3B drafts. */
export async function handleGstRoutes({ request, admin, ctx, key }: AccountantRoute) {
  const org = ctx.organizationId;
  if (key === "GET ai-accountant/tax-profiles") return listTaxProfiles(admin, org);
  if (key === "POST ai-accountant/tax-profiles") return saveTaxProfile(admin, org, await jsonBody(request), ctx.userId);
  if (key === "POST ai-accountant/tax-profiles/import") {
    const body = z.object({ csv: z.string().min(1).max(500_000) }).parse(await jsonBody(request));
    return importTaxProfilesCsv(admin, org, body.csv, ctx.userId);
  }
  if (key === "GET ai-accountant/gst/drafts") return listGstDrafts(admin, org);
  if (key === "POST ai-accountant/gst/drafts") return prepareGstReturn(admin, org, await jsonBody(request));
  return null;
}
