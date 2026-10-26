import type { SupabaseClient } from "@supabase/supabase-js";
import { createBackgroundJob } from "@/modules/jobs/service";
import { getSalesInvoiceSettings } from "@/modules/sales-invoices/service";

export async function maybeEnqueueSalesInvoice(
  supabase: SupabaseClient,
  input: { organizationId: string; orderId: string; event: "ORDER_CREATED" | "PAYMENT_CONFIRMED"; userId?: string }
) {
  const settings = await getSalesInvoiceSettings(supabase, input.organizationId);
  if (!settings.autoIssue || settings.autoIssueEvent !== input.event) return;
  await createBackgroundJob(supabase, {
    organizationId: input.organizationId,
    jobType: "sales-invoice-issue",
    entityType: "order",
    entityId: input.orderId,
    userId: input.userId,
  });
}

export async function runAutoSalesInvoice(supabase: SupabaseClient, organizationId: string, orderId: string, userId?: string) {
  const { createSalesInvoiceFromOrder, issueSalesInvoice } = await import("@/modules/sales-invoices/service");
  const invoice = await createSalesInvoiceFromOrder(supabase, organizationId, orderId, userId);
  if (invoice.status === "ISSUED" || invoice.status === "CANCELLED") return invoice;
  return issueSalesInvoice(supabase, organizationId, invoice.id, userId);
}
