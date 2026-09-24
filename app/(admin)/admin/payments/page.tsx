"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { api } from "@/lib/hooks/use-api";
import { formatDate, formatPaise } from "@/lib/format";

export default function AdminPaymentsPage() {
  const query = useQuery({
    queryKey: ["admin", "payments"],
    queryFn: () =>
      api<{
        payments: Array<{
          id: string;
          amount_paise: number;
          status: string;
          billing_cycle?: string;
          razorpay_payment_id?: string;
          razorpay_subscription_id?: string;
          failure_reason?: string;
          created_at: string;
          method?: string;
          organizations?: { name?: string };
          plans?: { name?: string };
        }>;
      }>("/api/admin/payments"),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Payments" description="Razorpay transactions across every workspace." />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Cycle</th>
              <th className="px-4 py-3">Payment ID</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {(query.data?.payments ?? []).map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-4 py-3">{row.organizations?.name ?? "—"}</td>
                <td className="px-4 py-3">{row.plans?.name ?? "—"}</td>
                <td className="px-4 py-3">{formatPaise(row.amount_paise)}</td>
                <td className="px-4 py-3">
                  <StatusBadge value={row.status} />
                </td>
                <td className="px-4 py-3">{row.billing_cycle ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs">{row.razorpay_payment_id ?? "—"}</td>
                <td className="px-4 py-3">{formatDate(row.created_at, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
