"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AccountAdminActions } from "@/components/admin/account-actions";
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

type SignupRow = {
  id: string;
  fullName: string | null;
  email: string | null;
  whatsappNumber: string | null;
  createdAt: string;
  organization: { id: string; name: string; slug: string } | null;
};

export default function AdminAccountsPage() {
  const [q, setQ] = useState("");
  const query = useQuery({
    queryKey: ["admin", "accounts", q],
    queryFn: () => api<{ accounts: AccountRow[]; signups: SignupRow[] }>(`/api/admin/accounts?q=${encodeURIComponent(q)}`),
  });
  const signups = query.data?.signups ?? [];
  const accounts = query.data?.accounts ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Accounts" description="New signups and workspaces. Search, block, suspend, hold, or permanently delete workspaces." />
      <Input
        placeholder="Search name, email, WhatsApp, or workspace"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        className="max-w-sm"
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">New signups</h2>
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">WhatsApp</th>
                <th className="px-4 py-3">Workspace</th>
                <th className="px-4 py-3">Signed up</th>
              </tr>
            </thead>
            <tbody>
              {signups.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-muted" colSpan={5}>
                    {query.isLoading ? "Loading signups…" : "No signups match this search."}
                  </td>
                </tr>
              ) : (
                signups.map((signup) => (
                  <tr key={signup.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-ink">{signup.fullName || "—"}</td>
                    <td className="px-4 py-3">{signup.email || "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{signup.whatsappNumber || "—"}</td>
                    <td className="px-4 py-3">
                      {signup.organization ? (
                        <Link
                          href={`/admin/accounts/${signup.organization.id}`}
                          className="block font-medium text-ink hover:text-brand"
                        >
                          {signup.organization.name}
                          <div className="text-xs font-normal text-muted">{signup.organization.slug}</div>
                        </Link>
                      ) : (
                        <span className="text-muted">No workspace</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{formatDate(signup.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">Workspaces</h2>
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-muted" colSpan={5}>
                    {query.isLoading ? "Loading workspaces…" : "No workspaces match this search."}
                  </td>
                </tr>
              ) : (
                accounts.map((account) => {
                  const plan = account.subscription?.plans;
                  const planName = Array.isArray(plan) ? plan[0]?.name : plan?.name;
                  return (
                    <tr key={account.id} className="border-t border-border align-top">
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
                      <td className="px-4 py-3">
                        <AccountAdminActions accountId={account.id} accountName={account.name} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
