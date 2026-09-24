"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { api } from "@/lib/hooks/use-api";
import { formatDate, formatPaise } from "@/lib/format";

type SubscriptionRow = {
  id: string;
  status: string;
  billing_cycle: string;
  amount_paise: number;
  started_at?: string | null;
  created_at?: string | null;
  current_period_end: string;
  organization_id?: string;
  organizations?: { id?: string; name?: string; slug?: string } | null;
  plans?: { name?: string };
  owner?: { email?: string | null; fullName?: string | null } | null;
};

export default function AdminSubscriptionsPage() {
  const query = useQuery({
    queryKey: ["admin", "subscriptions"],
    queryFn: () => api<{ subscriptions: SubscriptionRow[] }>("/api/admin/subscriptions"),
  });
  const rows = query.data?.subscriptions ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Subscriptions" description="Live and historical workspace subscriptions." />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Cycle</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Renews</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-sm text-muted" colSpan={7}>
                  {query.isLoading
                    ? "Loading subscriptions…"
                    : query.isError
                      ? query.error instanceof Error
                        ? query.error.message
                        : "Could not load subscriptions."
                      : "No subscriptions yet."}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const orgId = row.organizations?.id ?? row.organization_id;
                return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      {orgId ? (
                        <Link href={`/admin/accounts/${orgId}`} className="font-medium text-ink hover:text-brand">
                          {row.organizations?.name ?? "Workspace"}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">{row.organizations?.name ?? "—"}</span>
                      )}
                      <div className="text-xs text-muted">{row.owner?.email ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3">{row.plans?.name ?? "—"}</td>
                    <td className="px-4 py-3 capitalize">{row.billing_cycle}</td>
                    <td className="px-4 py-3">
                      <StatusBadge value={row.status} />
                    </td>
                    <td className="px-4 py-3">{formatPaise(row.amount_paise)}</td>
                    <td className="px-4 py-3">{formatDate(row.started_at ?? row.created_at)}</td>
                    <td className="px-4 py-3">{formatDate(row.current_period_end)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
