import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { assertAdminActionPin } from "@/lib/admin/action-pin";
import { assessSubscriptionInvoice, financialYearSeries, invoiceDocumentTitle, parseInvoiceListQuery, taxInvoiceIssuanceEnabled } from "@/modules/billing/subscription-invoice";
import { renderSubscriptionInvoicePdf, type SubscriptionInvoicePdfInput } from "@/modules/billing/subscription-invoice-pdf";

function pdfResponse(bytes: Uint8Array, filename: string) {
    return new NextResponse(new Uint8Array(bytes), {
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
            "Cache-Control": "private, no-store",
        },
    });
}

async function ownedPayment(supabase: SupabaseClient, organizationId: string, paymentId: string) {
    const { data, error } = await supabase.from("payments").select("id,organization_id,subscription_id,amount_paise,currency,billing_cycle,status,razorpay_payment_id").eq("id", paymentId).eq("organization_id", organizationId).maybeSingle();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Payment not found.");
    return data;
}

/** Postgres reports 42P01; PostgREST reports PGRST205 when the table is not in its schema cache. */
function missingTable(error: { code?: string } | null | undefined) {
    return error?.code === "42P01" || error?.code === "PGRST205";
}

function planName(value: { name?: string } | { name?: string }[] | null) {
    if (Array.isArray(value)) return value[0]?.name ?? "Subscription";
    return value?.name ?? "Subscription";
}

export async function listSubscriptionTaxInvoices(supabase: SupabaseClient, organizationId: string, params: URLSearchParams) {
    let query;
    try {
        query = parseInvoiceListQuery(params);
    } catch (error) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, error instanceof Error ? error.message : "Invoice query is invalid.");
    }
    const empty = { documents: [], page: query.page, pageSize: query.pageSize, total: 0, issuanceEnabled: taxInvoiceIssuanceEnabled() };
    let request = supabase.from("payments").select("id,amount_paise,status,billing_cycle,created_at,razorpay_payment_id,plans(name)", { count: "exact" }).eq("organization_id", organizationId).neq("billing_cycle", "ai_credits");
    if (query.paymentStatus) request = request.eq("status", query.paymentStatus);
    if (query.from) request = request.gte("created_at", `${query.from}T00:00:00.000Z`);
    if (query.to) request = request.lte("created_at", `${query.to}T23:59:59.999Z`);
    if (query.q) {
        const matches = await supabase.from("subscription_tax_invoices").select("payment_id").eq("organization_id", organizationId).ilike("invoice_number", `%${query.q}%`).limit(25);
        if (matches.error && !missingTable(matches.error)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, matches.error.message);
        const ids = (matches.data ?? []).map((row) => row.payment_id);
        const clauses = [`razorpay_payment_id.ilike.%${query.q}%`];
        if (ids.length > 0) clauses.push(`id.in.(${ids.join(",")})`);
        request = request.or(clauses.join(","));
    }
    if (query.status) {
        const issued = await supabase.from("subscription_tax_invoices").select("payment_id").eq("organization_id", organizationId).limit(1000);
        if (issued.error && missingTable(issued.error)) {
            if (query.status === "ISSUED") return empty;
        } else if (issued.error) {
            throw new AppError(ERROR_CODES.VALIDATION_ERROR, issued.error.message);
        } else {
            const ids = (issued.data ?? []).map((row) => row.payment_id);
            if (query.status === "ISSUED") {
                if (ids.length === 0) return empty;
                request = request.in("id", ids);
            } else if (ids.length > 0) request = request.not("id", "in", `(${ids.join(",")})`);
        }
    }
    const column = query.sort === "amount" ? "amount_paise" : "created_at";
    const { data, error, count } = await request.order(column, { ascending: query.direction === "asc" }).range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    const paymentIds = (data ?? []).map((row) => row.id);
    const invoices = paymentIds.length === 0
        ? { data: [], error: null }
        : await supabase.from("subscription_tax_invoices").select("payment_id,invoice_number,issued_at,plan_name,period_start,period_end,gross_paise,total_tax_paise,status").eq("organization_id", organizationId).in("payment_id", paymentIds);
    if (invoices.error && !missingTable(invoices.error)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, invoices.error.message);
    const byPayment = new Map((invoices.data ?? []).map((row) => [row.payment_id, row]));
    return {
        page: query.page,
        pageSize: query.pageSize,
        total: count ?? 0,
        issuanceEnabled: taxInvoiceIssuanceEnabled(),
        documents: (data ?? []).map((payment) => {
            const invoice = byPayment.get(payment.id);
            const issued = Boolean(invoice);
            return {
                paymentId: payment.id,
                invoiceNumber: invoice?.invoice_number ?? null,
                invoiceDate: invoice?.issued_at ?? payment.created_at,
                planName: invoice?.plan_name ?? planName(payment.plans as { name?: string } | { name?: string }[] | null),
                billingCycle: payment.billing_cycle,
                periodStart: invoice?.period_start ?? null,
                periodEnd: invoice?.period_end ?? null,
                grossPaise: Number(invoice?.gross_paise ?? payment.amount_paise ?? 0),
                gstPaise: invoice ? Number(invoice.total_tax_paise) : null,
                paymentStatus: payment.status,
                invoiceStatus: issued ? "ISSUED" : "PREVIEW",
                documentTitle: invoiceDocumentTitle(issued),
            };
        }),
    };
}

export async function getOrganizationBillingProfile(supabase: SupabaseClient, organizationId: string) {
    const { data, error } = await supabase.from("organization_billing_profiles").select("legal_name,address,gstin").eq("organization_id", organizationId).maybeSingle();
    if (missingTable(error)) return { profile: null, migrationRequired: true };
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return { profile: data ? { legalName: data.legal_name, address: data.address, gstin: data.gstin } : null, migrationRequired: false };
}

export async function saveOrganizationBillingProfile(supabase: SupabaseClient, organizationId: string, input: { legalName: string; address: string; gstin: string }) {
    const gstin = input.gstin.trim().toUpperCase();
    if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Customer GSTIN must be 15 letters or digits, or empty.");
    const { error } = await supabase.from("organization_billing_profiles").upsert({ organization_id: organizationId, legal_name: input.legalName.trim(), address: input.address.trim(), gstin, updated_at: new Date().toISOString() });
    if (missingTable(error)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Billing details cannot be saved yet. Please try again later.");
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return { saved: true };
}

export async function subscriptionInvoicePdf(supabase: SupabaseClient, organizationId: string, paymentId: string) {
    const payment = await ownedPayment(supabase, organizationId, paymentId);
    const issued = await supabase.from("subscription_tax_invoices").select("*").eq("payment_id", payment.id).eq("organization_id", organizationId).maybeSingle();
    if (issued.error && !missingTable(issued.error)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, issued.error.message);
    if (issued.data) {
        const row = issued.data;
        const bytes = await renderSubscriptionInvoicePdf({
            issued: true,
            invoiceNumber: row.invoice_number,
            invoiceDate: row.issued_at,
            periodLabel: `${row.period_start ?? "—"} to ${row.period_end ?? "—"}`,
            planName: row.plan_name,
            billingCycle: row.billing_cycle,
            supplierLegalName: row.supplier_legal_name,
            supplierAddress: row.supplier_address,
            supplierGstin: row.supplier_gstin,
            customerLegalName: row.customer_legal_name,
            customerAddress: row.customer_address,
            customerGstin: row.customer_gstin,
            placeOfSupply: row.place_of_supply,
            serviceDescription: row.service_description,
            grossPaise: BigInt(row.gross_paise),
            taxablePaise: BigInt(row.taxable_paise),
            cgstPaise: BigInt(row.cgst_paise),
            sgstPaise: BigInt(row.sgst_paise),
            igstPaise: BigInt(row.igst_paise),
            totalTaxPaise: BigInt(row.total_tax_paise),
            paymentStatus: payment.status,
            paymentReference: row.payment_reference,
            blockers: [],
        });
        return pdfResponse(bytes, `${row.invoice_number}.pdf`);
    }
    const [breakdown, settings, profile] = await Promise.all([
        supabase.from("subscription_tax_breakdowns").select("gross_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_tax_paise,policy_version").eq("payment_id", payment.id).maybeSingle(),
        supabase.from("subscription_invoice_settings").select("legal_name,address,gstin").eq("id", true).maybeSingle(),
        supabase.from("organization_billing_profiles").select("legal_name,address,gstin").eq("organization_id", organizationId).maybeSingle(),
    ]);
    const gross = BigInt(payment.amount_paise ?? 0);
    const tax = breakdown.data ? {
        taxablePaise: BigInt(breakdown.data.taxable_paise),
        cgstPaise: BigInt(breakdown.data.cgst_paise),
        sgstPaise: BigInt(breakdown.data.sgst_paise),
        igstPaise: BigInt(breakdown.data.igst_paise),
        totalTaxPaise: BigInt(breakdown.data.total_tax_paise),
    } : { taxablePaise: BigInt(0), cgstPaise: BigInt(0), sgstPaise: BigInt(0), igstPaise: BigInt(0), totalTaxPaise: BigInt(0) };
    const readiness = assessSubscriptionInvoice({
        grossPaise: gross,
        ...tax,
        policyApproved: Boolean(breakdown.data),
        supplierLegalName: settings.data?.legal_name ?? "",
        supplierAddress: settings.data?.address ?? "",
        supplierGstin: settings.data?.gstin ?? "",
        customerLegalName: profile.data?.legal_name ?? "",
        customerAddress: profile.data?.address ?? "",
        customerGstin: profile.data?.gstin ?? "",
    });
    const input: SubscriptionInvoicePdfInput = {
        issued: false,
        invoiceNumber: null,
        invoiceDate: null,
        periodLabel: "Not issued",
        planName: "Subscription",
        billingCycle: String(payment.billing_cycle ?? ""),
        supplierLegalName: settings.data?.legal_name ?? "",
        supplierAddress: settings.data?.address ?? "",
        supplierGstin: settings.data?.gstin ?? "",
        customerLegalName: profile.data?.legal_name ?? "",
        customerAddress: profile.data?.address ?? "",
        customerGstin: profile.data?.gstin ?? "",
        placeOfSupply: null,
        serviceDescription: "PostBus subscription",
        grossPaise: gross,
        ...tax,
        paymentStatus: String(payment.status ?? ""),
        paymentReference: payment.razorpay_payment_id,
        blockers: readiness.blockers,
    };
    const bytes = await renderSubscriptionInvoicePdf(input);
    return pdfResponse(bytes, "invoice-preview.pdf");
}

export async function saveSubscriptionInvoiceSettings(supabase: SupabaseClient, actorId: string, input: { legalName: string; address: string; gstin: string; prefix: string }) {
    const gstin = input.gstin.trim().toUpperCase();
    const prefix = input.prefix.trim().toUpperCase();
    if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Supplier GSTIN must be 15 letters or digits, or empty.");
    if (!/^[A-Z0-9]{1,8}$/.test(prefix)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Invoice prefix must be 1 to 8 letters or digits.");
    const { error } = await supabase.from("subscription_invoice_settings").update({ legal_name: input.legalName.trim(), address: input.address.trim(), gstin, numbering_prefix: prefix, updated_by: actorId, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    await supabase.from("billing_audit_logs").insert({ actor_id: actorId, actor_type: "SUPER_ADMIN", action: "tax_invoice.settings", target_type: "subscription_invoice_settings", target_id: "1", metadata: { gstinConfigured: Boolean(gstin) } });
    return { saved: true };
}

export async function issueSubscriptionTaxInvoice(supabase: SupabaseClient, actorId: string, paymentId: string) {
    if (!taxInvoiceIssuanceEnabled()) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Tax invoice issuance is disabled.");
    const payment = await supabase.from("payments").select("id,organization_id,subscription_id,amount_paise,currency,billing_cycle,razorpay_payment_id").eq("id", paymentId).maybeSingle();
    if (payment.error || !payment.data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Payment not found.");
    const [breakdown, settings, profile] = await Promise.all([
        supabase.from("subscription_tax_breakdowns").select("*").eq("payment_id", paymentId).maybeSingle(),
        supabase.from("subscription_invoice_settings").select("*").eq("id", true).maybeSingle(),
        supabase.from("organization_billing_profiles").select("*").eq("organization_id", payment.data.organization_id).maybeSingle(),
    ]);
    if (!breakdown.data) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Approved tax breakdown is missing.");
    const readiness = assessSubscriptionInvoice({
        grossPaise: BigInt(breakdown.data.gross_paise),
        taxablePaise: BigInt(breakdown.data.taxable_paise),
        cgstPaise: BigInt(breakdown.data.cgst_paise),
        sgstPaise: BigInt(breakdown.data.sgst_paise),
        igstPaise: BigInt(breakdown.data.igst_paise),
        totalTaxPaise: BigInt(breakdown.data.total_tax_paise),
        policyApproved: true,
        supplierLegalName: settings.data?.legal_name ?? "",
        supplierAddress: settings.data?.address ?? "",
        supplierGstin: settings.data?.gstin ?? "",
        customerLegalName: profile.data?.legal_name ?? "",
        customerAddress: profile.data?.address ?? "",
        customerGstin: profile.data?.gstin ?? "",
    });
    if (!readiness.ready) throw new AppError(ERROR_CODES.VALIDATION_ERROR, readiness.blockers.join(" "));
    const policy = await supabase.from("subscription_tax_policies").select("place_of_supply").eq("id", breakdown.data.policy_id).maybeSingle();
    const startMonth = Number(settings.data?.financial_year_start_month ?? 4);
    const { data, error } = await supabase.rpc("subscription_issue_tax_invoice", {
        p_actor: actorId,
        p_data: {
            paymentId,
            organizationId: payment.data.organization_id,
            subscriptionId: payment.data.subscription_id,
            policyId: breakdown.data.policy_id,
            policyVersion: breakdown.data.policy_version,
            grossPaise: Number(breakdown.data.gross_paise),
            taxablePaise: Number(breakdown.data.taxable_paise),
            cgstPaise: Number(breakdown.data.cgst_paise),
            sgstPaise: Number(breakdown.data.sgst_paise),
            igstPaise: Number(breakdown.data.igst_paise),
            totalTaxPaise: Number(breakdown.data.total_tax_paise),
            supplierLegalName: settings.data?.legal_name,
            supplierAddress: settings.data?.address,
            supplierGstin: settings.data?.gstin,
            customerLegalName: profile.data?.legal_name,
            customerAddress: profile.data?.address,
            customerGstin: profile.data?.gstin ?? "",
            placeOfSupply: policy.data?.place_of_supply ?? "",
            planName: "Subscription",
            billingCycle: payment.data.billing_cycle,
            prefix: settings.data?.numbering_prefix ?? "PB",
            series: financialYearSeries(new Date(), startMonth),
            serviceDescription: "PostBus subscription",
            paymentReference: payment.data.razorpay_payment_id,
        },
    });
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return { invoiceNumber: data };
}

export async function adminSubscriptionInvoices(supabase: SupabaseClient, params: URLSearchParams) {
    let query;
    try {
        query = parseInvoiceListQuery(params);
    } catch (error) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, error instanceof Error ? error.message : "Invoice query is invalid.");
    }
    let invoices = supabase.from("subscription_tax_invoices").select("id,invoice_number,organization_id,payment_id,plan_name,gross_paise,total_tax_paise,issued_at,status,payment_reference", { count: "exact" });
    if (query.organizationId) invoices = invoices.eq("organization_id", query.organizationId);
    if (query.q) invoices = invoices.or(`invoice_number.ilike.%${query.q}%,payment_reference.ilike.%${query.q}%`);
    if (query.from) invoices = invoices.gte("issued_at", `${query.from}T00:00:00.000Z`);
    if (query.to) invoices = invoices.lte("issued_at", `${query.to}T23:59:59.999Z`);
    const plan = params.get("plan")?.trim().slice(0, 40).replace(/[^A-Za-z0-9 _-]/g, "") ?? "";
    if (plan) invoices = invoices.ilike("plan_name", `%${plan}%`);
    const [settings, page, payments, issuedCount, audit] = await Promise.all([
        supabase.from("subscription_invoice_settings").select("legal_name,address,gstin,numbering_prefix").eq("id", true).maybeSingle(),
        invoices.order("issued_at", { ascending: query.direction === "asc" }).range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1),
        supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "CAPTURED").neq("billing_cycle", "ai_credits"),
        supabase.from("subscription_tax_invoices").select("id", { count: "exact", head: true }),
        supabase.from("billing_audit_logs").select("action,created_at,actor_id,target_id").in("action", ["tax_invoice.issued", "tax_invoice.settings"]).order("created_at", { ascending: false }).limit(20),
    ]);
    const missing = missingTable(settings.error) || missingTable(page.error);
    if (page.error && !missing) throw new AppError(ERROR_CODES.VALIDATION_ERROR, page.error.message);
    return {
        issuanceEnabled: taxInvoiceIssuanceEnabled(),
        migrationRequired: missing,
        settings: settings.data ?? { legal_name: "", address: "", gstin: "", numbering_prefix: "PB" },
        page: query.page,
        pageSize: query.pageSize,
        total: page.count ?? 0,
        capturedSubscriptionPayments: payments.count ?? 0,
        issuedInvoices: issuedCount.count ?? 0,
        invoices: page.data ?? [],
        audit: audit.data ?? [],
    };
}

export async function handleAdminTaxInvoices(supabase: SupabaseClient, request: NextRequest, actorId: string, slugs: string[], method: string) {
    if (method === "GET" && slugs.length === 0) return adminSubscriptionInvoices(supabase, request.nextUrl.searchParams);
    if (method === "GET" && slugs[0] === "reconcile") {
        const paymentId = request.nextUrl.searchParams.get("paymentId") ?? "";
        if (!z.string().uuid().safeParse(paymentId).success) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Payment id is invalid.");
        const { data, error } = await supabase.rpc("subscription_invoice_reconcile", { p_payment: paymentId });
        if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
        return { paymentId, category: data };
    }
    if (method === "PATCH" && slugs[0] === "settings") {
        const body = z.object({ pin: z.string().min(1), legalName: z.string().trim().max(160), address: z.string().trim().max(400), gstin: z.string().trim().max(15).default(""), prefix: z.string().trim().min(1).max(8) }).parse(await request.json());
        assertAdminActionPin(body.pin);
        return saveSubscriptionInvoiceSettings(supabase, actorId, body);
    }
    if (method === "POST" && slugs[0] === "issue") {
        const body = z.object({ pin: z.string().min(1), paymentId: z.string().uuid() }).parse(await request.json());
        assertAdminActionPin(body.pin);
        return issueSubscriptionTaxInvoice(supabase, actorId, body.paymentId);
    }
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}
