/**
 * Pure posting rules: business events -> balanced double-entry line sets.
 * All amounts are non-negative integer paise. No I/O here.
 */
import { interStateSplit, intraStateSplit, splitInclusiveTax } from "@/modules/ai-accountant/money";

export type GstComponent = "CGST" | "SGST" | "IGST" | "CESS";

export type PostingLine = {
  accountKey: string;
  debitPaise: number;
  creditPaise: number;
  memo?: string | null;
  party?: string | null;
  gstComponent?: GstComponent | null;
};

export type PostingEntry = {
  sourceType: string;
  sourceId: string;
  sourceEvent: string;
  entryDate: string;
  memo: string;
  lines: PostingLine[];
};

export type GstSplit = { cgstPaise: number; sgstPaise: number; igstPaise: number };

export const ZERO_GST: GstSplit = { cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };

function dr(accountKey: string, paise: number, extra?: Partial<PostingLine>): PostingLine {
  return { accountKey, debitPaise: paise, creditPaise: 0, ...extra };
}

function cr(accountKey: string, paise: number, extra?: Partial<PostingLine>): PostingLine {
  return { accountKey, debitPaise: 0, creditPaise: paise, ...extra };
}

function assertPaise(label: string, value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer paise amount.`);
  }
}

export function gstTotal(split: GstSplit) {
  return split.cgstPaise + split.sgstPaise + split.igstPaise;
}

/** Splits a tax amount into CGST+SGST (same state) or IGST. Unknown states default to IGST. */
export function splitTax(taxPaise: number, merchantState?: string | null, placeOfSupply?: string | null): GstSplit {
  assertPaise("tax", taxPaise);
  if (merchantState && placeOfSupply && merchantState === placeOfSupply) return intraStateSplit(taxPaise);
  return interStateSplit(taxPaise);
}

/** Drops zero lines and merges duplicates per account+side+gst component. */
export function normalizeLines(lines: PostingLine[]): PostingLine[] {
  const merged = new Map<string, PostingLine>();
  for (const line of lines) {
    assertPaise(`${line.accountKey} debit`, line.debitPaise);
    assertPaise(`${line.accountKey} credit`, line.creditPaise);
    if (line.debitPaise > 0 && line.creditPaise > 0) {
      throw new Error(`${line.accountKey} line has both a debit and a credit.`);
    }
    if (line.debitPaise === 0 && line.creditPaise === 0) continue;
    const side = line.debitPaise > 0 ? "D" : "C";
    const key = `${line.accountKey}|${side}|${line.gstComponent ?? ""}`;
    const existing = merged.get(key);
    if (existing) {
      existing.debitPaise += line.debitPaise;
      existing.creditPaise += line.creditPaise;
    } else {
      merged.set(key, { ...line });
    }
  }
  return [...merged.values()];
}

export function entryTotals(lines: PostingLine[]) {
  return lines.reduce(
    (acc, line) => ({ debitPaise: acc.debitPaise + line.debitPaise, creditPaise: acc.creditPaise + line.creditPaise }),
    { debitPaise: 0, creditPaise: 0 }
  );
}

export function assertBalanced(entry: PostingEntry): PostingEntry {
  const lines = normalizeLines(entry.lines);
  if (lines.length < 2) throw new Error(`${entry.sourceType}:${entry.sourceEvent} needs at least two non-zero lines.`);
  const totals = entryTotals(lines);
  if (totals.debitPaise !== totals.creditPaise) {
    throw new Error(
      `${entry.sourceType}:${entry.sourceEvent} is unbalanced (debit ${totals.debitPaise}, credit ${totals.creditPaise}).`
    );
  }
  return { ...entry, lines };
}

function gstLines(prefix: "gst_output" | "gst_input", split: GstSplit, side: "D" | "C"): PostingLine[] {
  const make = side === "D" ? dr : cr;
  return [
    make(`${prefix}_cgst`, split.cgstPaise, { gstComponent: "CGST" }),
    make(`${prefix}_sgst`, split.sgstPaise, { gstComponent: "SGST" }),
    make(`${prefix}_igst`, split.igstPaise, { gstComponent: "IGST" }),
  ];
}

export type OrderSaleInput = {
  orderId: string;
  orderNumber: string;
  entryDate: string;
  totalPaise: number;
  shippingPaise: number;
  /** COD collectable by India Post; the rest is treated as prepaid via gateway. */
  codPaise: number;
  /** Output GST on this sale. Zero when the merchant is not GST registered. */
  gst: GstSplit;
  customer?: string | null;
};

/**
 * Sale recognised when the shipment is booked: Dr COD receivable / gateway
 * receivable for the order total; Cr sales (net of tax and shipping), shipping
 * income and GST output.
 */
export function orderSaleEntry(input: OrderSaleInput): PostingEntry {
  assertPaise("order total", input.totalPaise);
  const codPaise = Math.min(input.codPaise, input.totalPaise);
  const taxPaise = gstTotal(input.gst);
  const shippingPaise = Math.min(input.shippingPaise, Math.max(0, input.totalPaise - taxPaise));
  const salesPaise = input.totalPaise - taxPaise - shippingPaise;
  if (salesPaise < 0) throw new Error(`Order ${input.orderNumber} tax exceeds its total.`);
  const party = input.customer ?? null;
  return assertBalanced({
    sourceType: "order",
    sourceId: input.orderId,
    sourceEvent: "sale",
    entryDate: input.entryDate,
    memo: `Sale ${input.orderNumber}`,
    lines: [
      dr("cod_receivable", codPaise, { party }),
      dr("accounts_receivable", input.totalPaise - codPaise, { party }),
      cr("sales", salesPaise),
      cr("shipping_income", shippingPaise),
      ...gstLines("gst_output", input.gst, "C"),
    ],
  });
}

/** RTO: reverses the sale into sales returns and reverses output GST (credit note). */
export function orderReturnEntry(input: OrderSaleInput): PostingEntry {
  const sale = orderSaleEntry(input);
  return assertBalanced({
    ...sale,
    sourceEvent: "rto",
    memo: `RTO ${input.orderNumber}`,
    lines: sale.lines.map((line) => ({
      ...line,
      accountKey: line.accountKey === "sales" || line.accountKey === "shipping_income" ? "sales_returns" : line.accountKey,
      debitPaise: line.creditPaise,
      creditPaise: line.debitPaise,
    })),
  });
}

export type ShipmentChargeInput = {
  shipmentId: string;
  reference: string;
  entryDate: string;
  tariffPaise: number;
};

/** India Post tariff owed for a booked article (settled on the contract bill). */
export function shipmentChargeEntry(input: ShipmentChargeInput): PostingEntry {
  assertPaise("tariff", input.tariffPaise);
  return assertBalanced({
    sourceType: "shipment",
    sourceId: input.shipmentId,
    sourceEvent: "tariff",
    entryDate: input.entryDate,
    memo: `India Post postage ${input.reference}`,
    lines: [dr("shipping_expense", input.tariffPaise), cr("india_post_payable", input.tariffPaise, { party: "India Post" })],
  });
}

export type CodRemittanceInput = {
  reportRowId: string;
  article: string;
  entryDate: string;
  netPaise: number;
  commissionPaise: number;
};

/** India Post remits COD net of commission: Dr bank + commission, Cr COD receivable. */
export function codRemittanceEntry(input: CodRemittanceInput): PostingEntry {
  assertPaise("COD net", input.netPaise);
  assertPaise("COD commission", input.commissionPaise);
  return assertBalanced({
    sourceType: "cod_report_row",
    sourceId: input.reportRowId,
    sourceEvent: "remittance",
    entryDate: input.entryDate,
    memo: `COD remittance ${input.article}`,
    lines: [
      dr("bank", input.netPaise),
      dr("cod_commission", input.commissionPaise, { party: "India Post" }),
      cr("cod_receivable", input.netPaise + input.commissionPaise, { party: "India Post" }),
    ],
  });
}

export type ExpenseInput = {
  expenseId: string;
  entryDate: string;
  categoryKey: string;
  /** Gross amount paid, including any GST. */
  totalPaise: number;
  /** Claimable input GST. Zero when no valid tax invoice or not registered. */
  itc: GstSplit;
  paymentAccountKey: string;
  vendor?: string | null;
  memo?: string | null;
};

export function expenseEntry(input: ExpenseInput): PostingEntry {
  assertPaise("expense", input.totalPaise);
  const itcPaise = gstTotal(input.itc);
  if (itcPaise > input.totalPaise) throw new Error("Input GST exceeds the expense amount.");
  const party = input.vendor ?? null;
  return assertBalanced({
    sourceType: "expense",
    sourceId: input.expenseId,
    sourceEvent: "expense",
    entryDate: input.entryDate,
    memo: input.memo || `Expense ${input.categoryKey}`,
    lines: [
      dr(input.categoryKey, input.totalPaise - itcPaise, { party }),
      ...gstLines("gst_input", input.itc, "D"),
      cr(input.paymentAccountKey, input.totalPaise, { party }),
    ],
  });
}

export type PurchaseInput = {
  purchaseId: string;
  entryDate: string;
  categoryKey: string;
  taxablePaise: number;
  gst: GstSplit;
  itcEligible: boolean;
  paymentAccountKey: string;
  vendor: string;
  invoiceNumber?: string | null;
};

/** Purchase invoice: ineligible GST is capitalised into the cost line. */
export function purchaseEntry(input: PurchaseInput): PostingEntry {
  assertPaise("taxable value", input.taxablePaise);
  const taxPaise = gstTotal(input.gst);
  const totalPaise = input.taxablePaise + taxPaise;
  const costPaise = input.itcEligible ? input.taxablePaise : totalPaise;
  return assertBalanced({
    sourceType: "purchase_invoice",
    sourceId: input.purchaseId,
    sourceEvent: "purchase",
    entryDate: input.entryDate,
    memo: `Purchase ${input.vendor}${input.invoiceNumber ? ` #${input.invoiceNumber}` : ""}`,
    lines: [
      dr(input.categoryKey, costPaise, { party: input.vendor }),
      ...(input.itcEligible ? gstLines("gst_input", input.gst, "D") : []),
      cr(input.paymentAccountKey, totalPaise, { party: input.vendor }),
    ],
  });
}

export type PlatformPaymentInput = {
  paymentId: string;
  entryDate: string;
  amountPaise: number;
  purpose: string;
  /** Input GST from the PostBus tax invoice when the merchant can claim it. */
  itc?: GstSplit;
};

/** PostBus subscription / add-on / AI credit payment captured via Razorpay. */
export function platformPaymentEntry(input: PlatformPaymentInput): PostingEntry {
  assertPaise("payment", input.amountPaise);
  const accountKey = input.purpose === "ai_credits" ? "ai_credits" : "platform_fees";
  const itc = input.itc ?? ZERO_GST;
  const itcPaise = gstTotal(itc);
  if (itcPaise > input.amountPaise) throw new Error("Input GST exceeds the payment amount.");
  return assertBalanced({
    sourceType: "payment",
    sourceId: input.paymentId,
    sourceEvent: "captured",
    entryDate: input.entryDate,
    memo: `PostBus ${input.purpose.replace(/_/g, " ")}`,
    lines: [
      dr(accountKey, input.amountPaise - itcPaise, { party: "PostBus" }),
      ...gstLines("gst_input", itc, "D"),
      cr("bank", input.amountPaise, { party: "PostBus" }),
    ],
  });
}

/** Mirror entry used to reverse a posted entry. */
export function reversalLines(lines: PostingLine[]): PostingLine[] {
  return lines.map((line) => ({ ...line, debitPaise: line.creditPaise, creditPaise: line.debitPaise }));
}

/** GST included in a gross amount at a rate, split by state. */
export function inclusiveGst(
  grossPaise: number,
  rateBps: number,
  merchantState?: string | null,
  placeOfSupply?: string | null
): { taxablePaise: number; gst: GstSplit } {
  if (rateBps <= 0) return { taxablePaise: grossPaise, gst: ZERO_GST };
  const { taxablePaise, taxPaise } = splitInclusiveTax(grossPaise, rateBps);
  return { taxablePaise, gst: splitTax(taxPaise, merchantState, placeOfSupply) };
}

export type CogsInput = {
  orderId: string;
  orderNumber: string;
  entryDate: string;
  cogsPaise: number;
  returned?: boolean;
};

/** Cost of goods for a dispatched order (Dr COGS, Cr inventory); RTO puts stock back. */
export function cogsEntry(input: CogsInput): PostingEntry {
  assertPaise("COGS", input.cogsPaise);
  const lines = [dr("cogs", input.cogsPaise), cr("inventory", input.cogsPaise)];
  return assertBalanced({
    sourceType: "order",
    sourceId: input.orderId,
    sourceEvent: input.returned ? "rto_cogs" : "cogs",
    entryDate: input.entryDate,
    memo: `${input.returned ? "Stock returned" : "Cost of goods"} ${input.orderNumber}`,
    lines: input.returned ? reversalLines(lines) : lines,
  });
}

/** Sum of unit cost x quantity; null when any line lacks a cost. */
export function orderCogsPaise(
  lines: Array<{ sku: string | null; quantity: number }>,
  unitCostBySku: Map<string, number>
): number | null {
  if (!lines.length) return null;
  let total = 0;
  for (const line of lines) {
    const sku = line.sku?.trim().toLowerCase();
    const cost = sku ? unitCostBySku.get(sku) : undefined;
    if (cost === undefined) return null;
    total += cost * line.quantity;
  }
  return total;
}
