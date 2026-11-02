/** Tally Prime XML import (ledger masters + journal vouchers). Pure. */

export type TallyLedger = { name: string; type: string; key: string | null };
export type TallyVoucher = {
  number: string;
  date: string;
  narration: string;
  lines: Array<{ ledger: string; debitPaise: number; creditPaise: number }>;
};

function esc(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function rupees(paise: number) {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Tally's predefined groups for our system accounts. */
export function tallyGroup(ledger: TallyLedger) {
  const key = ledger.key ?? "";
  if (key === "cash") return "Cash-in-Hand";
  if (key === "bank") return "Bank Accounts";
  if (key === "cod_receivable" || key === "accounts_receivable") return "Sundry Debtors";
  if (key === "inventory") return "Stock-in-Hand";
  if (key.startsWith("gst_")) return "Duties & Taxes";
  if (key === "accounts_payable" || key === "india_post_payable") return "Sundry Creditors";
  if (key === "cogs") return "Purchase Accounts";
  if (["shipping_expense", "cod_commission", "packaging"].includes(key)) return "Direct Expenses";
  if (key === "other_income") return "Indirect Incomes";
  switch (ledger.type) {
    case "ASSET":
      return "Current Assets";
    case "LIABILITY":
      return "Current Liabilities";
    case "EQUITY":
      return "Capital Account";
    case "REVENUE":
      return "Sales Accounts";
    default:
      return "Indirect Expenses";
  }
}

export function buildTallyXml(input: { company: string; ledgers: TallyLedger[]; vouchers: TallyVoucher[] }) {
  const masters = input.ledgers
    .map(
      (ledger) =>
        `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(ledger.name)}" ACTION="Create"><NAME.LIST><NAME>${esc(ledger.name)}</NAME></NAME.LIST><PARENT>${esc(
          tallyGroup(ledger)
        )}</PARENT></LEDGER></TALLYMESSAGE>`
    )
    .join("");
  const vouchers = input.vouchers
    .map((voucher) => {
      // Tally convention: debits are negative amounts with ISDEEMEDPOSITIVE=Yes.
      const lines = voucher.lines
        .map((line) => {
          const debit = line.debitPaise > 0;
          return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(line.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${rupees(
            debit ? -line.debitPaise : line.creditPaise
          )}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
        })
        .join("");
      return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>${voucher.date.replace(/-/g, "")}</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(
        voucher.number
      )}</VOUCHERNUMBER><NARRATION>${esc(voucher.narration)}</NARRATION>${lines}</VOUCHER></TALLYMESSAGE>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(
    input.company
  )}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${masters}${vouchers}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}
