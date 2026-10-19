import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { toCsv, UTF8_BOM } from "@/lib/csv";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { writeWorkbook, type SheetInput } from "@/lib/xlsx/write";
import { writeAccountingAudit } from "@/modules/ai-accountant/audit";
import { listAccounts } from "@/modules/ai-accountant/chart";
import { listCodReports } from "@/modules/ai-accountant/cod/ingest";
import { listExpenses } from "@/modules/ai-accountant/expenses";
import { prepareGstReturn } from "@/modules/ai-accountant/gst-service";
import { listJournal } from "@/modules/ai-accountant/ledger/post";
import { buildTallyXml } from "@/modules/ai-accountant/exports/tally";
import { AI_ACCOUNTANT_BUCKET, signedUrl } from "@/modules/ai-accountant/receipts";
import { balanceSheet, cashflow, profitAndLoss, trialBalance } from "@/modules/ai-accountant/reports/service";
import type { Period } from "@/modules/ai-accountant/period";

export const EXPORT_KINDS = ["JOURNAL", "TRIAL_BALANCE", "PNL", "CASHFLOW", "BALANCE", "GSTR1", "GSTR3B", "COD", "EXPENSES", "TALLY"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const exportSchema = z.object({
  kind: z.enum(EXPORT_KINDS),
  format: z.enum(["CSV", "XLSX", "XML"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const rs = (paise: number | string | null | undefined) => (paise === null || paise === undefined ? null : Number(paise) / 100);

type Line = { debit_paise: number; credit_paise: number; memo?: string | null; party?: string | null; gst_component?: string | null; ledger_accounts?: unknown };
type Entry = { entry_number: number; entry_date: string; memo: string | null; source_type: string | null; journal_lines?: Line[] };

function account(line: Line) {
  const value = line.ledger_accounts as { code: string; name: string } | Array<{ code: string; name: string }> | null;
  return (Array.isArray(value) ? value[0] : value) ?? { code: "", name: "" };
}

async function allJournal(supabase: SupabaseClient, organizationId: string, period: Period): Promise<Entry[]> {
  const out: Entry[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const chunk = await listJournal(supabase, organizationId, { ...period, page, pageSize: 200 });
    out.push(...(chunk.entries as unknown as Entry[]));
    if (out.length >= chunk.total || !chunk.entries.length) break;
  }
  return out.reverse();
}

function statementRows(title: string, sections: Array<{ heading: string; lines: Array<{ code: string; name: string; amountPaise: number }>; totalPaise?: number }>, footer: Array<[string, number]>) {
  const rows: SheetInput["rows"] = [[title, "", ""], ["Code", "Account", "Amount (₹)"]];
  for (const section of sections) {
    rows.push([section.heading, "", ""]);
    for (const line of section.lines) rows.push([line.code, line.name, rs(line.amountPaise)]);
    if (section.totalPaise !== undefined) rows.push(["", `Total ${section.heading.toLowerCase()}`, rs(section.totalPaise)]);
  }
  for (const [label, paise] of footer) rows.push(["", label, rs(paise)]);
  return rows;
}

/** Builds sheets for an export kind. TALLY returns XML text instead. */
export async function buildExport(
  supabase: SupabaseClient,
  organizationId: string,
  kind: ExportKind,
  period: Period
): Promise<{ sheets: SheetInput[] } | { xml: string }> {
  switch (kind) {
    case "JOURNAL": {
      const rows: SheetInput["rows"] = [["Entry #", "Date", "Memo", "Source", "Account code", "Account", "Debit (₹)", "Credit (₹)", "Party", "GST", "Line memo"]];
      for (const entry of await allJournal(supabase, organizationId, period)) {
        for (const line of entry.journal_lines ?? []) {
          const acc = account(line);
          rows.push([
            entry.entry_number,
            entry.entry_date,
            entry.memo,
            entry.source_type,
            acc.code,
            acc.name,
            rs(line.debit_paise) || null,
            rs(line.credit_paise) || null,
            line.party ?? null,
            line.gst_component ?? null,
            line.memo ?? null,
          ]);
        }
      }
      return { sheets: [{ name: "Journal", rows }] };
    }
    case "TRIAL_BALANCE": {
      const tb = await trialBalance(supabase, organizationId, period);
      const rows: SheetInput["rows"] = [["Code", "Account", "Type", "Debit (₹)", "Credit (₹)"]];
      for (const row of tb.accounts) rows.push([row.code, row.name, row.type, rs(row.debitPaise) || null, rs(row.creditPaise) || null]);
      rows.push(["", "Total", "", rs(tb.debitPaise), rs(tb.creditPaise)]);
      return { sheets: [{ name: "Trial balance", rows }] };
    }
    case "PNL": {
      const pnl = await profitAndLoss(supabase, organizationId, period);
      return {
        sheets: [
          {
            name: "Profit and loss",
            rows: statementRows(
              `Profit and loss ${period.from} to ${period.to}`,
              [
                { heading: "Revenue", lines: pnl.revenue, totalPaise: pnl.revenuePaise },
                { heading: "Direct costs", lines: pnl.directCosts, totalPaise: pnl.directCostPaise },
                { heading: "Operating expenses", lines: pnl.operating, totalPaise: pnl.operatingPaise },
              ],
              [
                ["Gross profit", pnl.grossProfitPaise],
                ["Net profit", pnl.netProfitPaise],
              ]
            ),
          },
        ],
      };
    }
    case "CASHFLOW": {
      const cf = await cashflow(supabase, organizationId, period);
      return {
        sheets: [
          {
            name: "Cash flow",
            rows: statementRows(
              `Cash flow ${period.from} to ${period.to}`,
              [{ heading: "Working capital adjustments", lines: cf.adjustments }],
              [
                ["Net profit", cf.netProfitPaise],
                ["Cash from operations", cf.operatingPaise],
                ["Cash from investing", cf.investingPaise],
                ["Cash from financing", cf.financingPaise],
                ["Net change in cash and bank", cf.netChangePaise],
              ]
            ),
          },
        ],
      };
    }
    case "BALANCE": {
      const bs = await balanceSheet(supabase, organizationId, period.to);
      return {
        sheets: [
          {
            name: "Balance sheet",
            rows: statementRows(
              `Balance sheet as at ${period.to}`,
              [
                { heading: "Assets", lines: bs.assets, totalPaise: bs.assetsPaise },
                { heading: "Liabilities", lines: bs.liabilities, totalPaise: bs.liabilitiesPaise },
                { heading: "Equity", lines: bs.equity, totalPaise: bs.equityPaise },
              ],
              []
            ),
          },
        ],
      };
    }
    case "GSTR1":
    case "GSTR3B": {
      const [year, month] = period.from.split("-").map(Number);
      const draft = (await prepareGstReturn(supabase, organizationId, { type: kind, month, year })) as Record<string, unknown>;
      if (draft.status === "INCOMPLETE") throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Add your GSTIN in AI Accountant settings first.");
      if (kind === "GSTR3B") {
        const pick = (obj: unknown) => obj as { cgstPaise: number; sgstPaise: number; igstPaise: number; taxablePaise?: number };
        const out = pick(draft.outwardTaxable);
        const itc = pick(draft.itcAvailable);
        const cash = pick(draft.cashPayable);
        return {
          sheets: [
            {
              name: "GSTR-3B",
              rows: [
                ["Section", "Taxable (₹)", "IGST (₹)", "CGST (₹)", "SGST (₹)"],
                ["3.1(a) Outward taxable supplies", rs(out.taxablePaise ?? 0), rs(out.igstPaise), rs(out.cgstPaise), rs(out.sgstPaise)],
                ["4(A)(5) ITC available", null, rs(itc.igstPaise), rs(itc.cgstPaise), rs(itc.sgstPaise)],
                ["Tax payable in cash", null, rs(cash.igstPaise), rs(cash.cgstPaise), rs(cash.sgstPaise)],
                [String(draft.disclaimer ?? "")],
              ],
            },
          ],
        };
      }
      type Row = { placeOfSupply?: string; rateBps: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number };
      const b2cs = (draft.b2cs as Row[]) ?? [];
      const hsn = (draft.hsn as Array<Row & { hsn: string }>) ?? [];
      const b2b = (draft.b2b as Array<{ orderNumber: string; date: string; customerGstin: string; placeOfSupply: string; valuePaise: number; byRate: Row[] }>) ?? [];
      return {
        sheets: [
          {
            name: "B2B",
            rows: [
              ["Customer GSTIN", "Invoice", "Date", "Place of supply", "Invoice value (₹)", "Rate %", "Taxable (₹)", "IGST (₹)", "CGST (₹)", "SGST (₹)"],
              ...b2b.flatMap((inv) =>
                inv.byRate.map((r) => [inv.customerGstin, inv.orderNumber, inv.date, inv.placeOfSupply, rs(inv.valuePaise), r.rateBps / 100, rs(r.taxablePaise), rs(r.igstPaise), rs(r.cgstPaise), rs(r.sgstPaise)])
              ),
            ],
          },
          {
            name: "B2CS",
            rows: [
              ["Place of supply", "Rate %", "Taxable (₹)", "IGST (₹)", "CGST (₹)", "SGST (₹)"],
              ...b2cs.map((r) => [r.placeOfSupply ?? "", r.rateBps / 100, rs(r.taxablePaise), rs(r.igstPaise), rs(r.cgstPaise), rs(r.sgstPaise)]),
            ],
          },
          {
            name: "HSN",
            rows: [
              ["HSN", "Rate %", "Taxable (₹)", "IGST (₹)", "CGST (₹)", "SGST (₹)"],
              ...hsn.map((r) => [r.hsn, r.rateBps / 100, rs(r.taxablePaise), rs(r.igstPaise), rs(r.cgstPaise), rs(r.sgstPaise)]),
            ],
          },
        ],
      };
    }
    case "COD": {
      const cod = await listCodReports(supabase, organizationId);
      const rows: SheetInput["rows"] = [["Article", "Status", "Reason", "Expected (₹)", "Reported (₹)", "Variance (₹)", "Commission (₹)", "Net (₹)", "Delivered", "Note"]];
      for (const row of cod.reconciliations as Array<Record<string, unknown>>) {
        const reportRow = (Array.isArray(row.cod_report_rows) ? row.cod_report_rows[0] : row.cod_report_rows) as Record<string, unknown> | null;
        rows.push([
          String(reportRow?.article_barcode ?? ""),
          String(row.status),
          (row.reason as string) ?? null,
          row.expected_cod as number,
          row.reported_cod as number,
          row.variance as number,
          (reportRow?.commission_amount as number) ?? null,
          (reportRow?.net_amount as number) ?? null,
          (reportRow?.delivered_on as string) ?? null,
          (row.resolution_note as string) ?? null,
        ]);
      }
      return { sheets: [{ name: "COD reconciliation", rows }] };
    }
    case "EXPENSES": {
      const data = await listExpenses(supabase, organizationId, period);
      const rows: SheetInput["rows"] = [["Date", "Category", "Vendor", "Amount (₹)", "GST (₹)", "Rate %", "Paid from", "Memo"]];
      for (const e of data.expenses as Array<Record<string, unknown>>) {
        rows.push([
          e.incurred_on as string,
          e.category as string,
          (e.vendor_name as string) ?? null,
          rs(e.amount_paise as number),
          rs(e.tax_paise as number),
          Number(e.rate_bps ?? 0) / 100,
          e.payment_account_key as string,
          (e.memo as string) ?? null,
        ]);
      }
      return { sheets: [{ name: "Expenses", rows }] };
    }
    case "TALLY": {
      const [accounts, entries, { data: org }] = await Promise.all([
        listAccounts(supabase, organizationId),
        allJournal(supabase, organizationId, period),
        supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
      ]);
      return {
        xml: buildTallyXml({
          company: String(org?.name ?? "PostBus"),
          ledgers: accounts.map((a) => ({ name: a.name, type: a.type, key: a.system_key })),
          vouchers: entries.map((entry) => ({
            number: `PB-${entry.entry_number}`,
            date: entry.entry_date,
            narration: entry.memo ?? "",
            lines: (entry.journal_lines ?? []).map((line) => ({
              ledger: account(line).name,
              debitPaise: Number(line.debit_paise),
              creditPaise: Number(line.credit_paise),
            })),
          })),
        }),
      };
    }
  }
}

export async function serializeExport(built: { sheets: SheetInput[] } | { xml: string }, format: "CSV" | "XLSX" | "XML") {
  if ("xml" in built) {
    if (format !== "XML") throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Tally exports are XML only.");
    return { bytes: new TextEncoder().encode(built.xml), contentType: "application/xml", ext: "xml" };
  }
  if (format === "XML") throw new AppError(ERROR_CODES.VALIDATION_ERROR, "XML is only available for Tally exports.");
  if (format === "XLSX") {
    return { bytes: await writeWorkbook(built.sheets), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
  }
  const csv = built.sheets.map((sheet) => (built.sheets.length > 1 ? toCsv([[sheet.name], ...sheet.rows]) : toCsv(sheet.rows))).join("\r\n");
  return { bytes: new TextEncoder().encode(UTF8_BOM + csv), contentType: "text/csv", ext: "csv" };
}

export async function createExport(supabase: SupabaseClient, organizationId: string, raw: unknown, userId: string) {
  const body = exportSchema.parse(raw);
  if (body.from > body.to) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Period start must be on or before the end.");
  const period = { from: body.from, to: body.to, label: `${body.from} to ${body.to}` };
  const { data: row, error } = await supabase
    .from("accounting_exports")
    .insert({ organization_id: organizationId, kind: body.kind, format: body.format, period_from: body.from, period_to: body.to, created_by: userId, status: "READY" })
    .select("id")
    .single();
  if (error || !row) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not start the export.");
  try {
    const file = await serializeExport(await buildExport(supabase, organizationId, body.kind, period), body.format);
    const path = `${organizationId}/exports/${row.id}-${body.kind.toLowerCase()}-${body.from}-${body.to}.${file.ext}`;
    const { error: uploadError } = await supabase.storage.from(AI_ACCOUNTANT_BUCKET).upload(path, file.bytes, { upsert: true, contentType: file.contentType });
    if (uploadError) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not store the export.");
    await supabase.from("accounting_exports").update({ file_path: path, byte_size: file.bytes.byteLength }).eq("id", row.id);
    await writeAccountingAudit(supabase, { organizationId, actorId: userId, action: "export.created", targetType: "accounting_export", targetId: row.id, metadata: body });
    return { id: row.id as string, url: await signedUrl(supabase, organizationId, path) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed.";
    logError("ai_accountant.export_failed", { organizationId, kind: body.kind, message });
    await supabase.from("accounting_exports").update({ status: "FAILED", error_message: message.slice(0, 300) }).eq("id", row.id);
    throw error instanceof AppError ? error : new AppError(ERROR_CODES.JOB_FAILED, "The export failed.");
  }
}

export async function listExports(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("accounting_exports")
    .select("id, kind, format, period_from, period_to, status, byte_size, error_message, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(50);
  return { exports: data ?? [] };
}

export async function exportDownloadUrl(supabase: SupabaseClient, organizationId: string, id: string) {
  const { data } = await supabase
    .from("accounting_exports")
    .select("file_path, status")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (!data?.file_path || data.status !== "READY") throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Export not found.");
  return { url: await signedUrl(supabase, organizationId, data.file_path) };
}
