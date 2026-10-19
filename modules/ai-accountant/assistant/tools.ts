import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listCodReports } from "@/modules/ai-accountant/cod/ingest";
import { listExpenses } from "@/modules/ai-accountant/expenses";
import { computeGstReturn } from "@/modules/ai-accountant/gst-service";
import { loadOverview } from "@/modules/ai-accountant/overview";
import { addDays } from "@/modules/ai-accountant/period";
import { orderContribution } from "@/modules/ai-accountant/profit";
import { balanceSheet, cashflow, profitAndLoss, trialBalance } from "@/modules/ai-accountant/reports/service";

/** Read-only tools the assistant may call. Every result is in integer paise with a completeness flag. */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z
  .object({ from: date, to: date })
  .refine((r) => r.from <= r.to, "from must be on or before to")
  .refine((r) => r.from >= addDays(r.to, -1100), "range is limited to three years");

type ToolDef<S extends z.ZodTypeAny> = {
  description: string;
  schema: S;
  parameters: Record<string, unknown>;
  run: (supabase: SupabaseClient, organizationId: string, args: z.infer<S>) => Promise<unknown>;
};

const rangeParams = {
  type: "object",
  properties: {
    from: { type: "string", description: "Start date YYYY-MM-DD (IST, inclusive)" },
    to: { type: "string", description: "End date YYYY-MM-DD (IST, inclusive)" },
  },
  required: ["from", "to"],
  additionalProperties: false,
};

function tool<S extends z.ZodTypeAny>(def: ToolDef<S>) {
  return def;
}

export const ASSISTANT_TOOLS = {
  get_books_status: tool({
    description: "Setup status, last ledger sync, this month's headline P&L, COD review queue and GST registration.",
    schema: z.object({}).strict(),
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (supabase, org) => loadOverview(supabase, org),
  }),
  get_profit_and_loss: tool({
    description: "Profit and loss from the ledger for a date range, with a monthly series when the range spans months.",
    schema: range,
    parameters: rangeParams,
    run: (supabase, org, args) => profitAndLoss(supabase, org, { ...args, label: `${args.from} to ${args.to}` }),
  }),
  get_cashflow: tool({
    description: "Indirect-method cash flow (operating, investing, financing) for a date range.",
    schema: range,
    parameters: rangeParams,
    run: (supabase, org, args) => cashflow(supabase, org, { ...args, label: `${args.from} to ${args.to}` }),
  }),
  get_balance_sheet: tool({
    description: "Balance sheet as at a date.",
    schema: z.object({ as_of: date }).strict(),
    parameters: { type: "object", properties: { as_of: { type: "string", description: "YYYY-MM-DD" } }, required: ["as_of"], additionalProperties: false },
    run: (supabase, org, args) => balanceSheet(supabase, org, args.as_of),
  }),
  get_trial_balance: tool({
    description: "Trial balance (debit/credit per account) for a date range.",
    schema: range,
    parameters: rangeParams,
    run: (supabase, org, args) => trialBalance(supabase, org, { ...args, label: `${args.from} to ${args.to}` }),
  }),
  get_gst_summary: tool({
    description: "GSTR-3B style summary for a month: outward tax, input tax credit, cash payable after set-off. Draft figures only.",
    schema: z.object({ month: z.number().int().min(1).max(12), year: z.number().int().min(2017).max(2100) }).strict(),
    parameters: {
      type: "object",
      properties: { month: { type: "integer", minimum: 1, maximum: 12 }, year: { type: "integer" } },
      required: ["month", "year"],
      additionalProperties: false,
    },
    run: async (supabase, org, args) => (await computeGstReturn(supabase, org, { type: "GSTR3B", ...args })).payload,
  }),
  get_cod_status: tool({
    description: "COD remittance reconciliation: counts by status and the latest rows needing review.",
    schema: z.object({}).strict(),
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: async (supabase, org) => {
      const cod = await listCodReports(supabase, org);
      return {
        summary: cod.summary,
        needsAttention: (cod.reconciliations as Array<Record<string, unknown>>)
          .filter((row) => row.status !== "RECONCILED")
          .slice(0, 10)
          .map((row) => ({ status: row.status, reason: row.reason, expectedRupees: row.expected_cod, reportedRupees: row.reported_cod })),
        recentReports: cod.reports.slice(0, 5),
      };
    },
  }),
  list_top_expenses: tool({
    description: "Expenses for a date range grouped by category, plus the largest individual expenses.",
    schema: range,
    parameters: rangeParams,
    run: async (supabase, org, args) => {
      const data = await listExpenses(supabase, org, args);
      const top = [...(data.expenses as Array<Record<string, unknown>>)]
        .sort((a, b) => Number(b.amount_paise ?? 0) - Number(a.amount_paise ?? 0))
        .slice(0, 10)
        .map((e) => ({ date: e.incurred_on, category: e.category, vendor: e.vendor_name, amountPaise: e.amount_paise }));
      return { totalPaise: data.totalPaise, byCategory: data.byCategory, top };
    },
  }),
  get_order_profit: tool({
    description: "Contribution margin for one order by its order number: revenue ex-tax minus product cost, postage and COD commission.",
    schema: z.object({ order_number: z.string().trim().min(1).max(40) }).strict(),
    parameters: { type: "object", properties: { order_number: { type: "string" } }, required: ["order_number"], additionalProperties: false },
    run: (supabase, org, args) => orderContribution(supabase, org, { orderNumber: args.order_number }),
  }),
} as const;

export type AssistantToolName = keyof typeof ASSISTANT_TOOLS;

export function openRouterToolSpecs() {
  return Object.entries(ASSISTANT_TOOLS).map(([name, def]) => ({
    type: "function" as const,
    function: { name, description: def.description, parameters: def.parameters },
  }));
}

const MAX_TOOL_RESULT_CHARS = 12_000;

/** Validates arguments and runs a tool; errors become a JSON result the model can explain. */
export async function runAssistantTool(supabase: SupabaseClient, organizationId: string, name: string, rawArgs: string) {
  const def = (ASSISTANT_TOOLS as Record<string, ToolDef<z.ZodTypeAny>>)[name];
  if (!def) return { ok: false, error: `Unknown tool ${name}` };
  let parsedArgs: unknown;
  try {
    parsedArgs = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { ok: false, error: "Arguments were not valid JSON." };
  }
  const args = def.schema.safeParse(parsedArgs);
  if (!args.success) return { ok: false, error: args.error.issues.map((i) => i.message).join("; ") };
  try {
    const result = await def.run(supabase, organizationId, args.data);
    let text = JSON.stringify(result);
    if (text.length > MAX_TOOL_RESULT_CHARS) text = `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…(truncated)`;
    return { ok: true, result: text };
  } catch {
    return { ok: false, error: "The data for this question could not be loaded." };
  }
}
