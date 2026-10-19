import type { SupabaseClient } from "@supabase/supabase-js";
import { istDate, monthPeriod } from "@/modules/ai-accountant/period";
import { buildProfitAndLoss } from "@/modules/ai-accountant/reports/statements";
import { accountTotals } from "@/modules/ai-accountant/reports/service";
import { loadAccountingWorkspace } from "@/modules/ai-accountant/settings";

/** Dashboard summary: setup checklist, this month's ledger P&L, COD queue, GST status. */
export async function loadOverview(supabase: SupabaseClient, organizationId: string) {
  const [y, m] = istDate().split("-").map(Number);
  const month = monthPeriod(y!, m!);
  const [workspace, totals, { data: codRows }, { count: profilesMissing }] = await Promise.all([
    loadAccountingWorkspace(supabase, organizationId),
    accountTotals(supabase, organizationId, month),
    supabase.from("cod_reconciliations").select("status").eq("organization_id", organizationId).neq("status", "RECONCILED").limit(5000),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("active", true),
  ]);
  const pnl = buildProfitAndLoss(totals);
  const cod: Record<string, number> = {};
  for (const row of codRows ?? []) cod[row.status] = (cod[row.status] ?? 0) + 1;
  const balanceOf = (key: string) => {
    const row = totals.find((t) => t.system_key === key);
    return row ? Number(row.debit_paise) - Number(row.credit_paise) : 0;
  };
  return {
    setup: workspace.setup,
    lastSyncedAt: workspace.settings?.last_synced_at ?? null,
    period: month,
    pnl: {
      revenuePaise: pnl.revenuePaise,
      directCostPaise: pnl.directCostPaise,
      operatingPaise: pnl.operatingPaise,
      netProfitPaise: pnl.netProfitPaise,
      grossMarginBps: pnl.grossMarginBps,
      completeness: pnl.completeness,
      notes: pnl.notes,
    },
    cod: {
      unmatched: cod.UNMATCHED ?? 0,
      needsReview: cod.NEEDS_REVIEW ?? 0,
      receivableMovementPaise: balanceOf("cod_receivable"),
    },
    gst: {
      registered: workspace.settings?.gst_registered ?? null,
      gstin: workspace.registration?.gstin ?? null,
      outputThisMonthPaise: -(balanceOf("gst_output_cgst") + balanceOf("gst_output_sgst") + balanceOf("gst_output_igst")),
      inputThisMonthPaise: balanceOf("gst_input_cgst") + balanceOf("gst_input_sgst") + balanceOf("gst_input_igst"),
      activeProducts: profilesMissing ?? 0,
    },
  };
}
