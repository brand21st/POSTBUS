"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { api } from "@/lib/hooks/use-api";
import { formatDate } from "@/lib/format";

export default function AdminAuditPage() {
  const query = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () =>
      api<{
        logs: Array<{
          id: string;
          actor_type: string;
          action: string;
          organization_id?: string;
          ip?: string;
          created_at: string;
        }>;
      }>("/api/admin/audit-logs"),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Audit logs" description="Immutable billing and admin actions. This list is read-only." />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {(query.data?.logs ?? []).map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-4 py-3">{formatDate(row.created_at, true)}</td>
                <td className="px-4 py-3">{row.actor_type}</td>
                <td className="px-4 py-3">{row.action}</td>
                <td className="px-4 py-3 font-mono text-xs">{row.organization_id?.slice(0, 8) ?? "—"}</td>
                <td className="px-4 py-3">{row.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
