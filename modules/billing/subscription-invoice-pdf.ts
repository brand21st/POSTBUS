import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { invoiceDocumentTitle } from "@/modules/billing/subscription-invoice";

export type SubscriptionInvoicePdfInput = {
    issued: boolean;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    periodLabel: string;
    planName: string;
    billingCycle: string;
    supplierLegalName: string;
    supplierAddress: string;
    supplierGstin: string;
    customerLegalName: string;
    customerAddress: string;
    customerGstin: string;
    placeOfSupply: string | null;
    serviceDescription: string;
    grossPaise: bigint;
    taxablePaise: bigint;
    cgstPaise: bigint;
    sgstPaise: bigint;
    igstPaise: bigint;
    totalTaxPaise: bigint;
    paymentStatus: string;
    paymentReference: string | null;
    blockers: string[];
};

function rupees(paise: bigint) {
    const sign = paise < BigInt(0) ? "-" : "";
    const abs = paise < BigInt(0) ? -paise : paise;
    return `${sign}Rs ${(abs / BigInt(100)).toString()}.${(abs % BigInt(100)).toString().padStart(2, "0")}`;
}

export async function renderSubscriptionInvoicePdf(input: SubscriptionInvoicePdfInput) {
    const document = await PDFDocument.create();
    const page = document.addPage([595.28, 841.89]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    const bold = await document.embedFont(StandardFonts.HelveticaBold);
    const title = invoiceDocumentTitle(input.issued);
    let y = 800;
    const draw = (text: string, size = 11, strong = false) => {
        page.drawText(text.slice(0, 110), { x: 48, y, size, font: strong ? bold : font, color: rgb(0.1, 0.1, 0.12) });
        y -= size + 8;
    };
    draw("POSTBUS", 18, true);
    draw(title, 16, true);
    if (!input.issued) draw("Draft preview. This is not an issued tax invoice.", 11, true);
    draw(`Invoice number: ${input.invoiceNumber ?? "Not issued"}`);
    draw(`Invoice date: ${input.invoiceDate ?? "Not issued"}`);
    draw(`Billing period: ${input.periodLabel}`);
    y -= 8;
    draw("From", 12, true);
    draw(input.supplierLegalName || "Supplier legal name not configured");
    draw(input.supplierAddress || "Supplier address not configured");
    draw(`GSTIN: ${input.supplierGstin || "Not configured"}`);
    y -= 8;
    draw("Bill to", 12, true);
    draw(input.customerLegalName || "Customer billing name not configured");
    draw(input.customerAddress || "Customer billing address not configured");
    draw(`GSTIN: ${input.customerGstin || "Not provided"}`);
    y -= 8;
    draw("Subscription", 12, true);
    draw(`${input.planName} - ${input.billingCycle}`);
    draw(input.serviceDescription);
    draw(`Place of supply: ${input.placeOfSupply ?? "Not recorded"}`);
    y -= 8;
    draw("Amounts", 12, true);
    draw(`Gross amount: ${rupees(input.grossPaise)}`);
    draw(`Taxable amount: ${rupees(input.taxablePaise)}`);
    draw(`CGST: ${rupees(input.cgstPaise)}`);
    draw(`SGST: ${rupees(input.sgstPaise)}`);
    draw(`IGST: ${rupees(input.igstPaise)}`);
    draw(`Total GST: ${rupees(input.totalTaxPaise)}`, 11, true);
    draw(`Total paid: ${rupees(input.grossPaise)}`, 12, true);
    y -= 8;
    draw(`Payment status: ${input.paymentStatus}`);
    draw(`Payment reference: ${input.paymentReference ?? "Not recorded"}`);
    if (input.blockers.length) {
        y -= 8;
        draw("Not issued because:", 11, true);
        for (const blocker of input.blockers.slice(0, 6)) draw(blocker);
    }
    return document.save();
}
