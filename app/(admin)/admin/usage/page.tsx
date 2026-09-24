"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { api } from "@/lib/hooks/use-api";

export default function AdminUsagePage() {
  const query = useQuery({
    queryKey: ["admin", "usage"],
    queryFn: () =>
      api<{
        usage: Array<{
          organization_id: string;
          orders_used: number;
          order_limit: number | null;
          period_start: string;
          organizations?: { name?: string };
        }>;
      }>("/api/admin/usage"),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Usage" description="Order consumption by workspace and billing period." />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Used</th>
              <th className="px-4 py-3">Limit</th>
              <th className="px-4 py-3">Period start</th>
            </tr>
          </thead>
          <tbody>
            {(query.data?.usage ?? []).map((row) => (
              <tr key={`${row.organization_id}-${row.period_start}`} className="border-t border-border">
                <td className="px-4 py-3">{row.organizations?.name ?? row.organization_id.slice(0, 8)}</td>
                <td className="px-4 py-3">{row.orders_used}</td>
                <td className="px-4 py-3">{row.order_limit ?? "—"}</td>
                <td className="px-4 py-3">{row.period_start}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
