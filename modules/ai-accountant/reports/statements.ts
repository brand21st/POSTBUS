/** Pure statement builders over per-account debit/credit totals. Amounts in paise. */
import { isDebitNormal } from "@/modules/ai-accountant/chart";

export type AccountTotal = {
  account_id?: string;
  code: string;
  name: string;
  type: string;
  system_key: string | null;
  debit_paise: number | string;
  credit_paise: number | string;
};

export type StatementLine = { code: string; name: string; key: string | null; amountPaise: number };

function num(value: number | string) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Signed balance in the account's normal direction. */
export function normalBalance(row: AccountTotal) {
  const net = num(row.debit_paise) - num(row.credit_paise);
  return isDebitNormal(row.type) ? net : -net;
}

function lines(rows: AccountTotal[], type: string): StatementLine[] {
  return rows
    .filter((row) => row.type === type)
    .map((row) => ({ code: row.code, name: row.name, key: row.system_key, amountPaise: normalBalance(row) }))
    .filter((line) => line.amountPaise !== 0);
}

function sum(items: StatementLine[]) {
  return items.reduce((total, line) => total + line.amountPaise, 0);
}

export function buildTrialBalance(rows: AccountTotal[]) {
  const accounts = rows
    .map((row) => {
      const net = num(row.debit_paise) - num(row.credit_paise);
      return {
        code: row.code,
        name: row.name,
        type: row.type,
        debitPaise: net > 0 ? net : 0,
        creditPaise: net < 0 ? -net : 0,
      };
    })
    .filter((row) => row.debitPaise !== 0 || row.creditPaise !== 0);
  const debitPaise = accounts.reduce((total, row) => total + row.debitPaise, 0);
  const creditPaise = accounts.reduce((total, row) => total + row.creditPaise, 0);
  return { accounts, debitPaise, creditPaise, balanced: debitPaise === creditPaise };
}

const DIRECT_COST_KEYS = new Set(["cogs", "shipping_expense", "cod_commission", "packaging"]);

export function buildProfitAndLoss(rows: AccountTotal[]) {
  const revenue = lines(rows, "REVENUE");
  const expenses = lines(rows, "EXPENSE");
  const directCosts = expenses.filter((line) => line.key && DIRECT_COST_KEYS.has(line.key));
  const operating = expenses.filter((line) => !line.key || !DIRECT_COST_KEYS.has(line.key));
  const revenuePaise = sum(revenue);
  const directCostPaise = sum(directCosts);
  const operatingPaise = sum(operating);
  const grossProfitPaise = revenuePaise - directCostPaise;
  const netProfitPaise = grossProfitPaise - operatingPaise;
  const hasCogs = directCosts.some((line) => line.key === "cogs");
  return {
    revenue,
    directCosts,
    operating,
    revenuePaise,
    directCostPaise,
    grossProfitPaise,
    operatingPaise,
    netProfitPaise,
    grossMarginBps: revenuePaise > 0 ? Math.round((grossProfitPaise * 10_000) / revenuePaise) : null,
    completeness: revenuePaise > 0 && !hasCogs ? ("INCOMPLETE" as const) : ("ACTUAL" as const),
    notes: revenuePaise > 0 && !hasCogs ? ["No cost of goods posted. Add purchases or product costs to see true profit."] : [],
  };
}

/**
 * Balance sheet as at a date (rows must be cumulative from the start of the books).
 * Current-period profit is shown inside equity so assets = liabilities + equity.
 */
export function buildBalanceSheet(rows: AccountTotal[]) {
  const assets = lines(rows, "ASSET");
  const liabilities = lines(rows, "LIABILITY");
  const equity = lines(rows, "EQUITY");
  const profit = buildProfitAndLoss(rows).netProfitPaise;
  const assetsPaise = sum(assets);
  const liabilitiesPaise = sum(liabilities);
  const equityPaise = sum(equity) + profit;
  return {
    assets,
    liabilities,
    equity: [...equity, { code: "—", name: "Profit to date", key: "profit_to_date", amountPaise: profit }],
    assetsPaise,
    liabilitiesPaise,
    equityPaise,
    balanced: assetsPaise === liabilitiesPaise + equityPaise,
  };
}

const CASH_KEYS = new Set(["cash", "bank"]);
const WORKING_CAPITAL_ASSETS = new Set([
  "cod_receivable",
  "accounts_receivable",
  "inventory",
  "gst_input_cgst",
  "gst_input_sgst",
  "gst_input_igst",
]);

/**
 * Indirect-method cash flow over a period (rows are movements within the period).
 * Operating = net profit − increase in working-capital assets + increase in liabilities.
 * Financing = owner capital movements. Any other asset movement is investing.
 */
export function buildCashflow(rows: AccountTotal[]) {
  const pnl = buildProfitAndLoss(rows);
  const adjustments: StatementLine[] = [];
  let investingPaise = 0;
  let financingPaise = 0;
  let cashChangePaise = 0;
  for (const row of rows) {
    const movement = normalBalance(row);
    if (movement === 0) continue;
    const key = row.system_key ?? "";
    if (row.type === "ASSET") {
      if (CASH_KEYS.has(key)) cashChangePaise += movement;
      else if (WORKING_CAPITAL_ASSETS.has(key) || !key) adjustments.push({ code: row.code, name: row.name, key, amountPaise: -movement });
      else investingPaise -= movement;
    } else if (row.type === "LIABILITY") {
      adjustments.push({ code: row.code, name: row.name, key, amountPaise: movement });
    } else if (row.type === "EQUITY") {
      financingPaise += movement;
    }
  }
  const operatingPaise = pnl.netProfitPaise + sum(adjustments);
  return {
    netProfitPaise: pnl.netProfitPaise,
    adjustments,
    operatingPaise,
    investingPaise,
    financingPaise,
    netChangePaise: operatingPaise + investingPaise + financingPaise,
    cashChangePaise,
    reconciles: operatingPaise + investingPaise + financingPaise === cashChangePaise,
  };
}
