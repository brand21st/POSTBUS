import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { ensureChartOfAccounts } from "@/modules/ai-accountant/chart";
import { monthsInPeriod, type Period } from "@/modules/ai-accountant/period";
import {
  buildBalanceSheet,
  buildCashflow,
  buildProfitAndLoss,
  buildTrialBalance,
  type AccountTotal,
} from "@/modules/ai-accountant/reports/statements";

export async function accountTotals(
  supabase: SupabaseClient,
  organizationId: string,
  range: { from: string | null; to: string | null }
): Promise<AccountTotal[]> {
  await ensureChartOfAccounts(supabase, organizationId);
  const { data, error } = await supabase.rpc("accounting_account_totals", {
    p_org: organizationId,
    p_from: range.from,
    p_to: range.to,
  });
  if (error) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not load account totals.");
  return (data ?? []) as AccountTotal[];
}

export async function trialBalance(supabase: SupabaseClient, organizationId: string, period: Period) {
  return { period, ...buildTrialBalance(await accountTotals(supabase, organizationId, period)) };
}

export async function profitAndLoss(supabase: SupabaseClient, organizationId: string, period: Period) {
  const pnl = buildProfitAndLoss(await accountTotals(supabase, organizationId, period));
  const months = monthsInPeriod(period).slice(-12);
  const series =
    months.length > 1
      ? await Promise.all(
          months.map(async (month) => {
            const monthPnl = buildProfitAndLoss(await accountTotals(supabase, organizationId, month));
            return {
              month: month.label,
              from: month.from,
              revenuePaise: monthPnl.revenuePaise,
              expensePaise: monthPnl.directCostPaise + monthPnl.operatingPaise,
              netProfitPaise: monthPnl.netProfitPaise,
            };
          })
        )
      : [];
  return { period, ...pnl, series };
}

export async function cashflow(supabase: SupabaseClient, organizationId: string, period: Period) {
  return { period, ...buildCashflow(await accountTotals(supabase, organizationId, period)) };
}

export async function balanceSheet(supabase: SupabaseClient, organizationId: string, asOf: string) {
  return { asOf, ...buildBalanceSheet(await accountTotals(supabase, organizationId, { from: null, to: asOf })) };
}
