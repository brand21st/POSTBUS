import { splitInclusiveTax, taxOnExclusive } from "@/modules/ai-accountant/money";
import { stateCodeFromName } from "@/modules/ai-accountant/gst";

export const UTGST_STATE_CODES = new Set(["04", "26", "31", "35", "38"]);

export type SellerScheme = "UNREGISTERED" | "REGULAR" | "COMPOSITION";
export type TaxSource = "IMPORTED" | "MANUAL" | "CALCULATED";
export type PricingMode = "INCLUSIVE" | "EXCLUSIVE";
export type LineTreatment = "TAXABLE" | "EXEMPT" | "ZERO_RATED";
export type DocumentType = "TAX_INVOICE" | "BILL_OF_SUPPLY" | "COMMERCIAL_INVOICE";

export type PartySnapshot = {
  name: string;
  company: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  country: string;
  phone: string;
  email: string;
  gstin: string;
};

export function emptyParty(): PartySnapshot {
  return {
    name: "",
    company: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    stateCode: "",
    pincode: "",
    country: "IN",
    phone: "",
    email: "",
    gstin: "",
  };
}

export function partyFromAddress(source: Record<string, unknown> | null | undefined, fallbackName = ""): PartySnapshot {
  const state = String(source?.state ?? "");
  return {
    name: String(source?.name ?? fallbackName),
    company: String(source?.company_name ?? ""),
    line1: String(source?.line1 ?? ""),
    line2: String(source?.line2 ?? ""),
    city: String(source?.city ?? ""),
    state,
    stateCode: String(source?.state_code ?? stateCodeFromName(state) ?? ""),
    pincode: String(source?.pincode ?? ""),
    country: String(source?.country ?? "IN"),
    phone: String(source?.phone ?? ""),
    email: String(source?.email ?? ""),
    gstin: String(source?.gstin ?? ""),
  };
}

/** Copies shipping into billing only when the merchant turns the checkbox on. */
export function billingAfterSameAddressToggle(input: {
  same: boolean;
  shipping: PartySnapshot;
  billing: PartySnapshot;
  explicitBilling: PartySnapshot | null;
}): PartySnapshot {
  if (input.same) {
    return {
      ...input.shipping,
      gstin: input.billing.gstin,
      email: input.billing.email || input.shipping.email,
      company: input.billing.company || input.shipping.company,
    };
  }
  return input.explicitBilling ?? input.billing;
}

export function placeOfSupply(input: { shipState?: string | null; billState?: string | null; shipCode?: string | null; billCode?: string | null }) {
  const shipCode = input.shipCode || stateCodeFromName(input.shipState);
  if (shipCode) return { code: shipCode, basis: "SHIP_TO" as const, stateName: input.shipState ?? "" };
  const billCode = input.billCode || stateCodeFromName(input.billState);
  if (billCode) return { code: billCode, basis: "BILL_TO" as const, stateName: input.billState ?? "" };
  return { code: null, basis: null, stateName: "" };
}

export type TaxComponent = {
  cgstPaise: number;
  sgstPaise: number;
  utgstPaise: number;
  igstPaise: number;
};

export function splitTaxComponents(taxPaise: number, supplierState: string, posState: string): TaxComponent & { intraState: boolean; stateComponent: "SGST" | "UTGST" | null } {
  if (!Number.isInteger(taxPaise) || taxPaise < 0) {
    throw new Error("GST amounts must be non-negative integers.");
  }
  const intraState = supplierState === posState;
  if (!intraState) {
    return { cgstPaise: 0, sgstPaise: 0, utgstPaise: 0, igstPaise: taxPaise, intraState: false, stateComponent: null };
  }
  const cgstPaise = Math.floor(taxPaise / 2);
  const statePaise = taxPaise - cgstPaise;
  if (UTGST_STATE_CODES.has(posState)) {
    return { cgstPaise, sgstPaise: 0, utgstPaise: statePaise, igstPaise: 0, intraState: true, stateComponent: "UTGST" };
  }
  return { cgstPaise, sgstPaise: statePaise, utgstPaise: 0, igstPaise: 0, intraState: true, stateComponent: "SGST" };
}

export function invoiceNumberRpcAllowed(role: string | null | undefined, isMember: boolean) {
  if (role === "service_role") return true;
  return role === "authenticated" && isMember;
}

export function financialYearLabel(date = new Date(), startMonth = 4) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const startYear = month >= startMonth ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

export function formatSalesInvoiceNumber(prefix: string, financialYear: string, sequence: number) {
  const clean = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length < 1 || clean.length > 4) {
    throw new Error("Invoice prefix must be 1 to 4 letters or digits.");
  }
  if (!/^\d{2}-\d{2}$/.test(financialYear)) throw new Error("Financial year is invalid.");
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error("Invoice sequence is invalid.");
  const number = `${clean}/${financialYear}/${String(sequence).padStart(5, "0")}`;
  if (number.length > 16) throw new Error("Invoice number exceeds 16 characters.");
  return number;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(value: number) {
  if (value < 20) return ONES[value];
  const ten = Math.floor(value / 10);
  const one = value % 10;
  return `${TENS[ten]}${one ? ` ${ONES[one]}` : ""}`;
}

function belowThousand(value: number) {
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  const head = hundred ? `${ONES[hundred]} Hundred` : "";
  const tail = rest ? belowHundred(rest) : "";
  return [head, tail].filter(Boolean).join(" ");
}

function indianNumberWords(value: number) {
  if (value === 0) return "Zero";
  const crore = Math.floor(value / 10000000);
  const lakh = Math.floor((value % 10000000) / 100000);
  const thousand = Math.floor((value % 100000) / 1000);
  const rest = value % 1000;
  return [
    crore ? `${belowThousand(crore)} Crore` : "",
    lakh ? `${belowHundred(lakh)} Lakh` : "",
    thousand ? `${belowHundred(thousand)} Thousand` : "",
    rest ? belowThousand(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function paiseInWords(paise: number) {
  if (!Number.isInteger(paise)) throw new Error("Amount in words requires integer paise.");
  const sign = paise < 0 ? "Minus " : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const paiseWords = fraction ? ` and ${indianNumberWords(fraction)} Paise` : "";
  return `${sign}${indianNumberWords(rupees)} Rupees${paiseWords} Only`;
}

export type CalcLineInput = {
  name: string;
  variant?: string | null;
  sku?: string | null;
  hsn?: string | null;
  quantity: number;
  unit?: string | null;
  unitPricePaise: number;
  discountPaise: number;
  rateBps: number | null;
  treatment: LineTreatment;
  sourceLineId?: string;
  imported?: {
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    utgstPaise: number;
    igstPaise: number;
    cessPaise: number;
    lineTotalPaise: number;
  };
};

export type CalculatedLine = CalcLineInput & {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  utgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  lineTotalPaise: number;
};

export type CalcInput = {
  scheme: SellerScheme;
  taxSource: TaxSource;
  pricing: PricingMode;
  supplierStateCode: string | null;
  posStateCode: string | null;
  lines: CalcLineInput[];
  orderDiscountPaise: number;
  shippingAmountPaise: number;
  shippingTaxable: boolean;
  shippingRateBps: number | null;
  importedTaxesIncluded: boolean | null;
  importedHeaderTaxPaise: number | null;
  importedGrandTotalPaise: number | null;
};

export type CalcResult = {
  status: "OK" | "REVIEW" | "BLOCKED";
  reasons: string[];
  documentType: DocumentType;
  lines: CalculatedLine[];
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  utgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  roundOffPaise: number;
  grandTotalPaise: number;
  intraState: boolean | null;
  stateComponent: "SGST" | "UTGST" | null;
};

function documentTypeFor(scheme: SellerScheme): DocumentType {
  if (scheme === "REGULAR") return "TAX_INVOICE";
  if (scheme === "COMPOSITION") return "BILL_OF_SUPPLY";
  return "COMMERCIAL_INVOICE";
}

function allocateDiscount(amounts: number[], discount: number) {
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (discount < 0) throw new Error("Discount cannot be negative.");
  if (discount === 0 || total === 0) return amounts.map(() => 0);
  if (discount > total) throw new Error("Discount exceeds the invoice amount.");
  let left = discount;
  return amounts.map((amount, index) => {
    if (index === amounts.length - 1) return left;
    const share = Math.floor((discount * amount) / total);
    left -= share;
    return share;
  });
}

function taxOnAmount(amountPaise: number, rateBps: number, pricing: PricingMode) {
  if (pricing === "INCLUSIVE") return splitInclusiveTax(amountPaise, rateBps);
  return { taxablePaise: amountPaise, taxPaise: taxOnExclusive(amountPaise, rateBps) };
}

export function calculateSalesInvoice(input: CalcInput): CalcResult {
  const reasons: string[] = [];
  let status: CalcResult["status"] = "OK";
  const block = (reason: string) => {
    reasons.push(reason);
    status = "BLOCKED";
  };
  const review = (reason: string) => {
    reasons.push(reason);
    if (status !== "BLOCKED") status = "REVIEW";
  };

  const documentType = documentTypeFor(input.scheme);
  const chargesGst = input.scheme === "REGULAR";
  if (!chargesGst && input.lines.some((line) => (line.rateBps ?? 0) > 0 || (line.imported && line.imported.cgstPaise + line.imported.sgstPaise + line.imported.utgstPaise + line.imported.igstPaise + line.imported.cessPaise > 0))) {
    block(input.scheme === "COMPOSITION" ? "composition_cannot_charge_gst" : "unregistered_cannot_charge_gst");
  }

  const supplier = input.supplierStateCode;
  const pos = input.posStateCode;
  let intraState: boolean | null = null;
  let stateComponent: "SGST" | "UTGST" | null = null;
  if (chargesGst) {
    if (!supplier || !pos) review("missing_place_of_supply");
    else {
      intraState = supplier === pos;
      stateComponent = intraState ? (UTGST_STATE_CODES.has(pos) ? "UTGST" : "SGST") : null;
    }
  }

  if (input.taxSource === "IMPORTED") {
    if (input.importedTaxesIncluded === null) review("shopify_taxes_included_missing");
    const lineTax = input.lines.reduce((sum, line) => {
      const tax = line.imported;
      if (!tax) return sum;
      return sum + tax.cgstPaise + tax.sgstPaise + tax.utgstPaise + tax.igstPaise + tax.cessPaise;
    }, 0);
    const headerTax = input.importedHeaderTaxPaise ?? 0;
    if (headerTax > 0 && lineTax === 0) review("shopify_tax_lines_missing");
    if (headerTax > 0 && lineTax > 0 && headerTax !== lineTax) review("shopify_tax_lines_do_not_match_header");
  }

  const bases = input.lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity === 0) block("invalid_quantity");
    if (!Number.isInteger(line.unitPricePaise) || line.unitPricePaise < 0) block("invalid_unit_price");
    if (!Number.isInteger(line.discountPaise) || line.discountPaise < 0) block("invalid_discount");
    const gross = Math.abs(line.quantity) * line.unitPricePaise - line.discountPaise;
    if (gross < 0) block("line_discount_exceeds_amount");
    return gross;
  });
  let orderShares: number[] = [];
  try {
    orderShares = allocateDiscount(bases, input.orderDiscountPaise);
  } catch {
    block("order_discount_exceeds_amount");
    orderShares = bases.map(() => 0);
  }

  const canSplit = Boolean(chargesGst && supplier && pos);
  const lines: CalculatedLine[] = input.lines.map((line, index) => {
    const net = Math.max(0, bases[index] - (orderShares[index] ?? 0));
    const sign = line.quantity < 0 ? -1 : 1;
    if (input.taxSource === "IMPORTED" && line.imported) {
      const imported = line.imported;
      return {
        ...line,
        taxablePaise: sign * imported.taxablePaise,
        cgstPaise: sign * imported.cgstPaise,
        sgstPaise: sign * imported.sgstPaise,
        utgstPaise: sign * imported.utgstPaise,
        igstPaise: sign * imported.igstPaise,
        cessPaise: sign * imported.cessPaise,
        lineTotalPaise: sign * imported.lineTotalPaise,
      };
    }
    const taxableTreatment = line.treatment === "TAXABLE" && (line.rateBps ?? 0) > 0 && chargesGst;
    if (line.treatment === "TAXABLE" && chargesGst && (line.rateBps === null || line.rateBps < 0)) {
      review("missing_line_rate");
    }
    if (!taxableTreatment || !canSplit || line.rateBps === null) {
      return {
        ...line,
        taxablePaise: sign * net,
        cgstPaise: 0,
        sgstPaise: 0,
        utgstPaise: 0,
        igstPaise: 0,
        cessPaise: 0,
        lineTotalPaise: sign * net,
      };
    }
    const taxed = taxOnAmount(net, line.rateBps, input.pricing);
    const split = splitTaxComponents(taxed.taxPaise, supplier as string, pos as string);
    return {
      ...line,
      taxablePaise: sign * taxed.taxablePaise,
      cgstPaise: sign * split.cgstPaise,
      sgstPaise: sign * split.sgstPaise,
      utgstPaise: sign * split.utgstPaise,
      igstPaise: sign * split.igstPaise,
      cessPaise: 0,
      lineTotalPaise: sign * (input.pricing === "INCLUSIVE" ? net : taxed.taxablePaise + taxed.taxPaise),
    };
  });

  const credit = input.lines.length > 0 && input.lines.every((line) => line.quantity < 0);
  const shippingSign = credit ? -1 : 1;
  let shippingTaxablePaise = 0;
  let shippingTax = { cgstPaise: 0, sgstPaise: 0, utgstPaise: 0, igstPaise: 0, cessPaise: 0 };
  let shippingTotal = input.shippingAmountPaise;
  if (!Number.isInteger(input.shippingAmountPaise) || input.shippingAmountPaise < 0) block("invalid_shipping");
  if (input.shippingAmountPaise > 0 && input.shippingTaxable && chargesGst) {
    if (input.shippingRateBps === null || input.shippingRateBps < 0) review("missing_shipping_rate");
    else if (canSplit) {
      const taxed = taxOnAmount(input.shippingAmountPaise, input.shippingRateBps, input.pricing);
      const split = splitTaxComponents(taxed.taxPaise, supplier as string, pos as string);
      shippingTaxablePaise = shippingSign * taxed.taxablePaise;
      shippingTax = {
        cgstPaise: shippingSign * split.cgstPaise,
        sgstPaise: shippingSign * split.sgstPaise,
        utgstPaise: shippingSign * split.utgstPaise,
        igstPaise: shippingSign * split.igstPaise,
        cessPaise: 0,
      };
      shippingTotal = input.pricing === "INCLUSIVE" ? input.shippingAmountPaise : taxed.taxablePaise + taxed.taxPaise;
    }
  }

  const sum = (pick: (line: CalculatedLine) => number) => lines.reduce((total, line) => total + pick(line), 0);
  const taxablePaise = sum((line) => line.taxablePaise) + shippingTaxablePaise;
  const cgstPaise = sum((line) => line.cgstPaise) + shippingTax.cgstPaise;
  const sgstPaise = sum((line) => line.sgstPaise) + shippingTax.sgstPaise;
  const utgstPaise = sum((line) => line.utgstPaise) + shippingTax.utgstPaise;
  const igstPaise = sum((line) => line.igstPaise) + shippingTax.igstPaise;
  const cessPaise = sum((line) => line.cessPaise) + shippingTax.cessPaise;
  const lineTotals = sum((line) => line.lineTotalPaise);
  const shippingGross = input.shippingAmountPaise === 0
    ? 0
    : input.pricing === "EXCLUSIVE" && input.shippingTaxable && canSplit && input.shippingRateBps !== null
      ? shippingTotal
      : input.shippingAmountPaise;
  const grandTotalPaise = input.taxSource === "IMPORTED" && input.importedGrandTotalPaise !== null
    ? input.importedGrandTotalPaise * (credit ? -1 : 1)
    : lineTotals + shippingSign * shippingGross;

  if (input.taxSource === "IMPORTED" && input.importedGrandTotalPaise !== null) {
    const rebuilt = lineTotals + input.shippingAmountPaise;
    if (rebuilt !== input.importedGrandTotalPaise && lineTotals !== 0) review("shopify_lines_do_not_match_order_total");
  }
  if (chargesGst && input.taxSource !== "IMPORTED" && status === "OK") {
    const tax = cgstPaise + sgstPaise + utgstPaise + igstPaise + cessPaise;
    if (input.pricing === "EXCLUSIVE") {
      const untaxedShipping = input.shippingAmountPaise > 0 && !input.shippingTaxable ? shippingSign * input.shippingAmountPaise : 0;
      const expected = taxablePaise + tax + untaxedShipping;
      if (expected !== grandTotalPaise) review("totals_do_not_reconcile");
    }
    if (input.pricing === "INCLUSIVE" && grandTotalPaise !== lineTotals + shippingSign * input.shippingAmountPaise) {
      review("inclusive_total_changed");
    }
  }

  const subtotalPaise = bases.reduce((sum, amount) => sum + amount, 0);
  return {
    status,
    reasons: [...new Set(reasons)],
    documentType,
    lines,
    subtotalPaise,
    discountPaise: input.lines.reduce((sum, line) => sum + line.discountPaise, 0) + input.orderDiscountPaise,
    shippingPaise: input.shippingAmountPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    utgstPaise,
    igstPaise,
    cessPaise,
    roundOffPaise: 0,
    grandTotalPaise,
    intraState,
    stateComponent,
  };
}
