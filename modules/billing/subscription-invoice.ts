/** Subscription tax-invoice decisions. Issuance stays off until the flag and supplier identity exist. */

export const taxInvoiceIssuanceEnabled = () => process.env.POSTBUS_BILLING_TAX_INVOICE_ENABLED === "true";

export type InvoiceReadiness = {
    ready: boolean;
    blockers: string[];
    customerGstinProvided: boolean;
};

export function financialYearSeries(date: Date, startMonth = 4) {
    if (startMonth < 1 || startMonth > 12) throw new Error("Financial year start is invalid");
    const month = date.getUTCMonth() + 1;
    const year = date.getUTCFullYear();
    const startYear = month >= startMonth ? year : year - 1;
    return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

export function formatSubscriptionInvoiceNumber(prefix: string, series: string, sequence: number) {
    if (!/^[A-Za-z0-9]{1,8}$/.test(prefix) || !/^\d{4}-\d{2}$/.test(series) || !Number.isInteger(sequence) || sequence < 1)
        throw new Error("Invoice numbering policy is incomplete");
    return `${prefix.toUpperCase()}/${series}/${String(sequence).padStart(6, "0")}`;
}

export function assessSubscriptionInvoice(input: {
    grossPaise: bigint;
    taxablePaise: bigint;
    cgstPaise: bigint;
    sgstPaise: bigint;
    igstPaise: bigint;
    totalTaxPaise: bigint;
    policyApproved: boolean;
    supplierLegalName: string;
    supplierAddress: string;
    supplierGstin: string;
    customerLegalName: string;
    customerAddress: string;
    customerGstin: string;
}) {
    const blockers: string[] = [];
    const taxParts = input.cgstPaise + input.sgstPaise + input.igstPaise;
    if (!input.policyApproved) blockers.push("Approved tax policy is missing");
    if (input.grossPaise <= BigInt(0) || input.taxablePaise + input.totalTaxPaise !== input.grossPaise || taxParts !== input.totalTaxPaise)
        blockers.push("Tax amounts do not reconcile");
    if (!input.supplierLegalName.trim()) blockers.push("Supplier legal name is missing");
    if (!input.supplierAddress.trim()) blockers.push("Supplier address is missing");
    if (!/^[0-9A-Za-z]{15}$/.test(input.supplierGstin.trim())) blockers.push("Supplier GSTIN is missing");
    if (!input.customerLegalName.trim()) blockers.push("Customer billing name is missing");
    if (!input.customerAddress.trim()) blockers.push("Customer billing address is missing");
    const customerGstin = input.customerGstin.trim();
    if (customerGstin && !/^[0-9A-Za-z]{15}$/.test(customerGstin)) blockers.push("Customer GSTIN is invalid");
    return { ready: blockers.length === 0, blockers, customerGstinProvided: /^[0-9A-Za-z]{15}$/.test(customerGstin) };
}

export function invoiceDocumentTitle(issued: boolean) {
    return issued ? "TAX INVOICE" : "INVOICE PREVIEW";
}

export function sanitizeInvoiceSearch(value: string) {
    return value.trim().slice(0, 80).replace(/[^A-Za-z0-9/_-]/g, "");
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseInvoiceListQuery(params: URLSearchParams) {
    const page = Number(params.get("page") ?? "1");
    const pageSize = Number(params.get("pageSize") ?? "10");
    const sort = params.get("sort") === "amount" ? "amount" : "date";
    const direction = params.get("direction") === "asc" ? "asc" : "desc";
    const status = params.get("status") === "ISSUED" || params.get("status") === "PREVIEW" ? params.get("status") : "";
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    if (!Number.isInteger(page) || page < 1 || page > 500) throw new Error("Page is invalid");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 25) throw new Error("Page size is invalid");
    if (from && !datePattern.test(from)) throw new Error("Start date is invalid");
    if (to && !datePattern.test(to)) throw new Error("End date is invalid");
    return {
        q: sanitizeInvoiceSearch(params.get("q") ?? ""),
        status: status as "" | "ISSUED" | "PREVIEW",
        paymentStatus: sanitizeInvoiceSearch(params.get("paymentStatus") ?? "").slice(0, 32),
        from,
        to,
        page,
        pageSize,
        sort: sort as "date" | "amount",
        direction: direction as "asc" | "desc",
        organizationId: /^[0-9a-f-]{36}$/i.test(params.get("organizationId") ?? "") ? params.get("organizationId") : "",
    };
}
