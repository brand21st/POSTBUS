"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Search, UserPlus } from "lucide-react";
import { AccountAdminActions } from "@/components/admin/account-actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/hooks/use-api";
import { formatDate, formatRelative, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

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

type TabId = "workspaces" | "signups";
type StatusFilter = "all" | "ACTIVE" | "BLOCKED" | "SUSPENDED" | "HOLD" | "DISABLED";

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "ACTIVE", label: "Active" },
  { id: "HOLD", label: "Hold" },
  { id: "BLOCKED", label: "Blocked" },
  { id: "SUSPENDED", label: "Suspended" },
  { id: "DISABLED", label: "Disabled" },
];

function planName(account: AccountRow) {
  const plan = account.subscription?.plans;
  return Array.isArray(plan) ? plan[0]?.name : plan?.name;
}

export default function AdminAccountsPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tab, setTab] = useState<TabId>("workspaces");
  const [status, setStatus] = useState<StatusFilter>("all");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  const query = useQuery({
    queryKey: ["admin", "accounts", debounced],
    queryFn: () =>
      api<{ accounts: AccountRow[]; signups: SignupRow[] }>(
        `/api/admin/accounts?q=${encodeURIComponent(debounced)}`
      ),
  });
  const signups = query.data?.signups ?? [];
  const accounts = query.data?.accounts ?? [];

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: accounts.length,
      ACTIVE: 0,
      BLOCKED: 0,
      SUSPENDED: 0,
      HOLD: 0,
      DISABLED: 0,
    };
    for (const account of accounts) {
      const key = account.account_status as StatusFilter;
      if (key in counts) counts[key] += 1;
    }
    return counts;
  }, [accounts]);

  const visibleAccounts = useMemo(
    () => (status === "all" ? accounts : accounts.filter((account) => account.account_status === status)),
    [accounts, status]
  );

  const visibleFilters = STATUS_FILTERS.filter((filter) => filter.id === "all" || statusCounts[filter.id] > 0);

  return (
    <div className="space-y-4">
      <PageHeader
        className="gap-3 sm:items-center"
        title="Accounts"
        description={
          query.isLoading
            ? "Loading workspaces and signups"
            : `${accounts.length} workspace${accounts.length === 1 ? "" : "s"} · ${signups.length} new signup${signups.length === 1 ? "" : "s"}`
        }
        actions={
          <label className="relative block w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              placeholder="Search name, email, WhatsApp…"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="h-9 pl-9 shadow-none"
            />
          </label>
        }
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex rounded-lg bg-surface-soft p-0.5">
            {(
              [
                { id: "workspaces", label: "Workspaces", count: accounts.length, icon: Building2 },
                { id: "signups", label: "Signups", count: signups.length, icon: UserPlus },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    active ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[11px] tabular-nums",
                      active ? "bg-surface-soft text-ink" : "bg-card text-muted",
                      item.id === "signups" && item.count > 0 && !active && "bg-rose-100 text-brand-dark"
                    )}
                  >
                    {item.count}
                  </span>
                </button>
              );
            })}
          </div>

          {tab === "workspaces" ? (
            <div className="flex flex-wrap items-center gap-1">
              {visibleFilters.map((filter) => {
                const active = status === filter.id;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setStatus(filter.id)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
                      active ? "bg-ink text-white" : "bg-surface-soft text-muted hover:text-ink"
                    )}
                  >
                    {filter.label}
                    <span className="ml-1 opacity-70">{statusCounts[filter.id]}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted">People who registered, with or without a workspace.</p>
          )}
        </div>

        {query.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : tab === "signups" ? (
          signups.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title={debounced ? "No signups match" : "No new signups"}
              description={debounced ? "Try a different name, email, or WhatsApp number." : "New registrations will appear here."}
              className="border-0 py-12 shadow-none"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-soft/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">Person</th>
                    <th className="hidden px-3 py-2 sm:table-cell">WhatsApp</th>
                    <th className="px-3 py-2">Workspace</th>
                    <th className="hidden px-3 py-2 md:table-cell">Signed up</th>
                  </tr>
                </thead>
                <tbody>
                  {signups.map((signup) => (
                    <tr key={signup.id} className="border-t border-border hover:bg-surface-soft/50">
                      <td className="px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-soft text-[11px] font-semibold text-ink">
                            {initials(signup.fullName, "NA")}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-ink">{signup.fullName || "—"}</div>
                            <div className="truncate text-xs text-muted">{signup.email || "No email"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 tabular-nums text-muted sm:table-cell">
                        {signup.whatsappNumber || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {signup.organization ? (
                          <Link href={`/admin/accounts/${signup.organization.id}`} className="block min-w-0 hover:text-brand">
                            <div className="truncate font-medium text-ink">{signup.organization.name}</div>
                            <div className="truncate text-xs font-normal text-muted">{signup.organization.slug}</div>
                          </Link>
                        ) : (
                          <span className="text-xs text-muted">No workspace</span>
                        )}
                      </td>
                      <td
                        className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted md:table-cell"
                        title={formatDate(signup.createdAt)}
                      >
                        {formatRelative(signup.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : visibleAccounts.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={debounced || status !== "all" ? "No workspaces match" : "No workspaces yet"}
            description={
              debounced || status !== "all"
                ? "Clear the search or status filter to see more accounts."
                : "New workspaces will show up in this list."
            }
            className="border-0 py-12 shadow-none"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-soft/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="hidden px-3 py-2 sm:table-cell">Plan</th>
                  <th className="hidden px-3 py-2 md:table-cell">Created</th>
                  <th className="w-10 px-2 py-2 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleAccounts.map((account) => (
                  <tr key={account.id} className="border-t border-border hover:bg-surface-soft/50">
                    <td className="px-3 py-2">
                      <Link href={`/admin/accounts/${account.id}`} className="flex min-w-0 items-center gap-2.5 hover:text-brand">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-[11px] font-semibold text-brand-dark">
                          {initials(account.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{account.name}</span>
                          <span className="block truncate text-xs text-muted">{account.slug}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge value={account.account_status} />
                    </td>
                    <td className="hidden px-3 py-2 text-muted sm:table-cell">{planName(account) ?? "—"}</td>
                    <td
                      className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted md:table-cell"
                      title={formatDate(account.created_at)}
                    >
                      {formatRelative(account.created_at)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <AccountAdminActions accountId={account.id} accountName={account.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
