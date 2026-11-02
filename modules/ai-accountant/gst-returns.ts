/** Pure GSTR-1 / GSTR-3B draft builders. Amounts are integer paise. Drafts only; nothing is filed. */

export type SupplyLine = {
  orderId: string;
  orderNumber: string;
  date: string;
  placeOfSupply: string;
  customerGstin: string | null;
  hsn: string | null;
  rateBps: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** RTO / credit note: reduces outward supplies. */
  isReturn: boolean;
};

export type TaxTotals = { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number };

/** Inter-state B2C invoices above this value go to B2CL (₹1 lakh from 1 Aug 2024). */
export const B2CL_THRESHOLD_PAISE = 1_00_000_00;

const zero = (): TaxTotals => ({ taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 });

function add(target: TaxTotals, line: TaxTotals, sign = 1) {
  target.taxablePaise += sign * line.taxablePaise;
  target.cgstPaise += sign * line.cgstPaise;
  target.sgstPaise += sign * line.sgstPaise;
  target.igstPaise += sign * line.igstPaise;
}

export function taxOf(totals: TaxTotals) {
  return totals.cgstPaise + totals.sgstPaise + totals.igstPaise;
}

function group<T extends TaxTotals>(map: Map<string, T>, key: string, make: () => T, line: TaxTotals, sign = 1) {
  const existing = map.get(key) ?? make();
  add(existing, line, sign);
  map.set(key, existing);
}

export function buildGstr1(lines: SupplyLine[]) {
  const invoices = new Map<string, { orderId: string; orderNumber: string; date: string; placeOfSupply: string; customerGstin: string | null; lines: SupplyLine[] }>();
  for (const line of lines.filter((l) => !l.isReturn)) {
    const invoice = invoices.get(line.orderId) ?? {
      orderId: line.orderId,
      orderNumber: line.orderNumber,
      date: line.date,
      placeOfSupply: line.placeOfSupply,
      customerGstin: line.customerGstin,
      lines: [],
    };
    invoice.lines.push(line);
    invoices.set(line.orderId, invoice);
  }

  const b2b: Array<{ orderNumber: string; date: string; customerGstin: string; placeOfSupply: string; valuePaise: number; byRate: Array<{ rateBps: number } & TaxTotals> }> = [];
  const b2cl: Array<{ orderNumber: string; date: string; placeOfSupply: string; valuePaise: number; byRate: Array<{ rateBps: number } & TaxTotals> }> = [];
  const b2cs = new Map<string, { placeOfSupply: string; rateBps: number } & TaxTotals>();

  for (const invoice of invoices.values()) {
    const byRateMap = new Map<string, { rateBps: number } & TaxTotals>();
    for (const line of invoice.lines) group(byRateMap, String(line.rateBps), () => ({ rateBps: line.rateBps, ...zero() }), line);
    const byRate = [...byRateMap.values()].sort((a, b) => a.rateBps - b.rateBps);
    const valuePaise = byRate.reduce((sum, row) => sum + row.taxablePaise + taxOf(row), 0);
    const interState = invoice.lines.some((line) => line.igstPaise > 0);
    if (invoice.customerGstin) {
      b2b.push({ orderNumber: invoice.orderNumber, date: invoice.date, customerGstin: invoice.customerGstin, placeOfSupply: invoice.placeOfSupply, valuePaise, byRate });
    } else if (interState && valuePaise > B2CL_THRESHOLD_PAISE) {
      b2cl.push({ orderNumber: invoice.orderNumber, date: invoice.date, placeOfSupply: invoice.placeOfSupply, valuePaise, byRate });
    } else {
      for (const row of byRate) {
        group(b2cs, `${invoice.placeOfSupply}|${row.rateBps}`, () => ({ placeOfSupply: invoice.placeOfSupply, rateBps: row.rateBps, ...zero() }), row);
      }
    }
  }

  const creditNotes = new Map<string, { orderNumber: string; date: string; placeOfSupply: string; customerGstin: string | null } & TaxTotals>();
  for (const line of lines.filter((l) => l.isReturn)) {
    group(
      creditNotes,
      line.orderId,
      () => ({ orderNumber: line.orderNumber, date: line.date, placeOfSupply: line.placeOfSupply, customerGstin: line.customerGstin, ...zero() }),
      line
    );
  }

  const hsn = new Map<string, { hsn: string; rateBps: number; quantityLines: number } & TaxTotals>();
  for (const line of lines) {
    const key = `${line.hsn ?? "NA"}|${line.rateBps}`;
    const row = hsn.get(key) ?? { hsn: line.hsn ?? "NA", rateBps: line.rateBps, quantityLines: 0, ...zero() };
    add(row, line, line.isReturn ? -1 : 1);
    row.quantityLines += line.isReturn ? -1 : 1;
    hsn.set(key, row);
  }

  const totals = zero();
  for (const line of lines) add(totals, line, line.isReturn ? -1 : 1);

  return {
    b2b,
    b2cl,
    b2cs: [...b2cs.values()].sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rateBps - b.rateBps),
    creditNotes: {
      registered: [...creditNotes.values()].filter((note) => note.customerGstin),
      unregistered: [...creditNotes.values()].filter((note) => !note.customerGstin),
    },
    hsn: [...hsn.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rateBps - b.rateBps),
    totals,
    invoiceCount: invoices.size,
  };
}

export type CreditLedger = { cgstPaise: number; sgstPaise: number; igstPaise: number };

/**
 * ITC set-off per CGST Act s.49 / rule 88A: IGST credit first against IGST, then
 * CGST, then SGST; CGST credit against CGST then IGST; SGST credit against SGST
 * then IGST. CGST and SGST never cross. Returns cash payable and leftover credit.
 */
export function setOff(liability: CreditLedger, credit: CreditLedger) {
  const due = { ...liability };
  const left = { ...credit };
  const apply = (from: keyof CreditLedger, to: keyof CreditLedger) => {
    const amount = Math.min(left[from], due[to]);
    left[from] -= amount;
    due[to] -= amount;
  };
  apply("igstPaise", "igstPaise");
  apply("igstPaise", "cgstPaise");
  apply("igstPaise", "sgstPaise");
  apply("cgstPaise", "cgstPaise");
  apply("cgstPaise", "igstPaise");
  apply("sgstPaise", "sgstPaise");
  apply("sgstPaise", "igstPaise");
  return { cashPayable: due, creditCarriedForward: left, totalCashPaise: due.cgstPaise + due.sgstPaise + due.igstPaise };
}

export function buildGstr3b(input: { outward: TaxTotals; itc: CreditLedger }) {
  const liability = { cgstPaise: Math.max(0, input.outward.cgstPaise), sgstPaise: Math.max(0, input.outward.sgstPaise), igstPaise: Math.max(0, input.outward.igstPaise) };
  return {
    outwardTaxable: input.outward,
    itcAvailable: input.itc,
    ...setOff(liability, input.itc),
  };
}
