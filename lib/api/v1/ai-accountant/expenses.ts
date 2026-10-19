import { formFile, jsonBody, periodFrom, uuidParam, type AccountantRoute } from "@/lib/api/v1/ai-accountant/shared";
import { createExpense, deleteExpense, listExpenses, updateExpense } from "@/modules/ai-accountant/expenses";
import { createPurchase, deletePurchase, listPurchases, updatePurchase } from "@/modules/ai-accountant/purchases";
import { attachReceipt, signedUrl } from "@/modules/ai-accountant/receipts";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

/** Expenses and purchase invoices, with receipt upload and signed receipt links. */
export async function handleExpenseRoutes({ request, admin, ctx, method, slugs }: AccountantRoute) {
  const org = ctx.organizationId;
  const resource = slugs[1];
  if (resource !== "expenses" && resource !== "purchases") return null;
  const table = resource === "expenses" ? "expenses" : "purchase_invoices";
  const id = slugs[2];

  if (!id) {
    if (method === "GET") {
      const period = periodFrom(request);
      return resource === "expenses"
        ? listExpenses(admin, org, { ...period, category: request.nextUrl.searchParams.get("category") })
        : listPurchases(admin, org, period);
    }
    if (method === "POST") {
      const body = await jsonBody(request);
      return resource === "expenses" ? createExpense(admin, org, body, ctx.userId) : createPurchase(admin, org, body, ctx.userId);
    }
    return null;
  }

  const recordId = uuidParam(id);
  if (slugs[3] === "receipt") {
    if (method === "POST") {
      const { file } = await formFile(request);
      return attachReceipt(admin, org, { table, id: recordId }, file);
    }
    if (method === "GET") {
      const { data } = await admin.from(table).select("receipt_path").eq("organization_id", org).eq("id", recordId).maybeSingle();
      if (!data?.receipt_path) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "No receipt attached.");
      return { url: await signedUrl(admin, org, data.receipt_path) };
    }
    return null;
  }
  if (slugs.length !== 3) return null;
  if (method === "PATCH") {
    const body = await jsonBody(request);
    return resource === "expenses"
      ? updateExpense(admin, org, recordId, body, ctx.userId)
      : updatePurchase(admin, org, recordId, body, ctx.userId);
  }
  if (method === "DELETE") {
    return resource === "expenses" ? deleteExpense(admin, org, recordId, ctx.userId) : deletePurchase(admin, org, recordId, ctx.userId);
  }
  return null;
}
