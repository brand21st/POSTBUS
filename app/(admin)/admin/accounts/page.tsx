"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/hooks/use-api";
import { formatDate } from "@/lib/format";

type AccountRow = {
  id: string;
  name: string;
  slug: string;
  account_status: string;
  created_at: string;
  subscription?: { status?: string; plans?: { name?: string } | { name?: string }[] | null } | null;
};

export default function AdminAccountsPage() {
  const [q, setQ] = useState("");
  const query = useQuery({
    queryKey: ["admin", "accounts", q],
    queryFn: () => api<{ accounts: AccountRow[] }>(`/api/admin/accounts?q=${encodeURIComponent(q)}`),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Accounts" description="Search and manage every workspace." />
      <Input placeholder="Search accounts" value={q} onChange={(event) => setQ(event.target.value)} className="max-w-sm" />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {(query.data?.accounts ?? []).map((account) => {
              const plan = account.subscription?.plans;
              const planName = Array.isArray(plan) ? plan[0]?.name : plan?.name;
              return (
                <tr key={account.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link href={`/admin/accounts/${account.id}`} className="font-medium text-ink hover:text-brand">
                      {account.name}
                    </Link>
                    <div className="text-xs text-muted">{account.slug}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge value={account.account_status} />
                  </td>
                  <td className="px-4 py-3">{planName ?? "—"}</td>
                  <td className="px-4 py-3">{formatDate(account.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
