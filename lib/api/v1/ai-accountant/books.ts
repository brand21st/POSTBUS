import { periodFrom, jsonBody, uuidParam, type AccountantRoute } from "@/lib/api/v1/ai-accountant/shared";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { listAccounts } from "@/modules/ai-accountant/chart";
import { listJournal, postManualEntry, reverseEntry, syncLedger } from "@/modules/ai-accountant/ledger/post";
import { loadOverview } from "@/modules/ai-accountant/overview";
import { fiscalYearPeriod, isIsoDate, istDate } from "@/modules/ai-accountant/period";
import { orderContribution } from "@/modules/ai-accountant/profit";
import { balanceSheet, cashflow, profitAndLoss, trialBalance } from "@/modules/ai-accountant/reports/service";
import { loadAccountingWorkspace, saveAccountingSettings, saveProductCost } from "@/modules/ai-accountant/settings";
import { writeAccountingAudit } from "@/modules/ai-accountant/audit";
import { z } from "zod";

/** Overview, settings, ledger, statements and per-order profit. */
export async function handleBooksRoutes({ request, admin, ctx, key, slugs, accessMode }: AccountantRoute) {
  const org = ctx.organizationId;
  if (key === "GET ai-accountant") return { accessMode, ...(await loadOverview(admin, org)) };
  if (key === "GET ai-accountant/settings") return { accessMode, ...(await loadAccountingWorkspace(admin, org)) };
  if (key === "PATCH ai-accountant/settings") {
    const result = await saveAccountingSettings(admin, org, await jsonBody(request));
    await writeAccountingAudit(admin, { organizationId: org, actorId: ctx.userId, action: "settings.updated" });
    return result;
  }
  if (key === "POST ai-accountant/product-costs") {
    const body = z.object({ productId: z.string().uuid(), unitCostPaise: z.number().int().positive().max(1_000_000_000) }).parse(await jsonBody(request));
    return saveProductCost(admin, org, { productId: body.productId, unitCost: body.unitCostPaise / 100 });
  }
  if (key === "GET ai-accountant/accounts") return { accounts: await listAccounts(admin, org) };
  if (key === "GET ai-accountant/journal") {
    const params = request.nextUrl.searchParams;
    return listJournal(admin, org, {
      ...periodFrom(request),
      page: Number(params.get("page") || 1),
      pageSize: Number(params.get("pageSize") || 50),
      sourceType: params.get("source"),
    });
  }
  if (key === "POST ai-accountant/journal") return postManualEntry(admin, org, await jsonBody(request), ctx.userId);
  if (slugs[1] === "journal" && slugs[3] === "reverse" && key.startsWith("POST ")) {
    return reverseEntry(admin, org, uuidParam(slugs[2], "Entry id"), ctx.userId);
  }
  if (key === "POST ai-accountant/ledger/sync") {
    const body = z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .parse(await request.json().catch(() => ({})));
    const today = istDate();
    const fy = fiscalYearPeriod(today);
    const period = {
      from: isIsoDate(body.from) ? body.from : fy.from,
      to: isIsoDate(body.to) ? body.to : today,
    };
    if (period.from > period.to) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Period start must be on or before the end.");
    const result = await syncLedger(admin, org, period);
    await writeAccountingAudit(admin, { organizationId: org, actorId: ctx.userId, action: "ledger.synced", metadata: { ...period, ...result } });
    return { period, ...result };
  }
  if (key === "GET ai-accountant/reports/pnl") return profitAndLoss(admin, org, periodFrom(request));
  if (key === "GET ai-accountant/reports/cashflow") return cashflow(admin, org, periodFrom(request));
  if (key === "GET ai-accountant/reports/trial-balance") return trialBalance(admin, org, periodFrom(request));
  if (key === "GET ai-accountant/reports/balance") {
    const asOf = request.nextUrl.searchParams.get("asOf");
    return balanceSheet(admin, org, isIsoDate(asOf) ? asOf : istDate());
  }
  if (key === "GET ai-accountant/profit") {
    return orderContribution(admin, org, { orderId: uuidParam(request.nextUrl.searchParams.get("orderId") ?? undefined, "Order id") });
  }
  return null;
}
