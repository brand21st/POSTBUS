"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronLeft, ChevronRight, MailWarning, Search, UserPlus } from "lucide-react";
import { AccountAdminActions } from "@/components/admin/account-actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ADMIN_ACCOUNT_PAGE_SIZE } from "@/lib/admin/account-list";
import { isUserOnline } from "@/lib/admin/user-presence";
import { api } from "@/lib/hooks/use-api";
import { formatDate, formatNumber, formatRelative, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

type AccountRow = {
  id: string;
  name: string;
  slug: string;
  account_status: string;
  created_at: string;
  lastActiveAt?: string | null;
  subscription?: {
    status?: string;
    billing_cycle?: string;
    plan_id?: string;
    plans?: { name?: string } | { name?: string }[] | null;
  } | null;
};

type SignupRow = {
  id: string;
  fullName: string | null;
  email: string | null;
  whatsappNumber: string | null;
  pincode: string | null;
  city: string | null;
  createdAt: string;
  lastActiveAt?: string | null;
  organization: { id: string; name: string; slug: string } | null;
};

type TabId = "workspaces" | "signups" | "abandoned";
type StatusFilter = "all" | "ACTIVE" | "BLOCKED" | "SUSPENDED" | "HOLD" | "DISABLED";

type AccountsResponse = {
  accounts: AccountRow[];
  signups: SignupRow[];
  totals?: {
    workspaces: number;
    signups: number;
    abandoned?: number;
    statuses?: Record<StatusFilter, number>;
  };
  page?: number;
  pageSize?: number;
};

function AccountsPager({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs tabular-nums text-muted">
        Showing {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-4" />
          Previous
        </Button>
        <span className="text-xs tabular-nums text-muted">
          {formatNumber(page)} / {formatNumber(pageCount)}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function ActiveTimeCell({ lastActiveAt, now }: { lastActiveAt?: string | null; now: number }) {
  const online = isUserOnline(lastActiveAt, now);
  return (
    <td
      className="whitespace-nowrap px-3 py-2 text-xs"
      title={lastActiveAt ? formatDate(lastActiveAt, true) : "Never seen"}
    >
      {online ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Online
        </span>
      ) : (
        <span className="text-muted">{lastActiveAt ? formatRelative(lastActiveAt) : "Never"}</span>
      )}
    </td>
  );
}

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
  const [workspacePage, setWorkspacePage] = useState(1);
  const [signupPage, setSignupPage] = useState(1);
  const [abandonedPage, setAbandonedPage] = useState(1);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    setWorkspacePage(1);
    setSignupPage(1);
    setAbandonedPage(1);
  }, [debounced]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const page = tab === "signups" ? signupPage : tab === "abandoned" ? abandonedPage : workspacePage;
  const query = useQuery({
    queryKey: ["admin", "accounts", debounced, tab, page, status],
    queryFn: () => {
      const params = new URLSearchParams({
        q: debounced,
        tab,
        page: String(page),
        pageSize: String(ADMIN_ACCOUNT_PAGE_SIZE),
      });
      if (tab === "workspaces" && status !== "all") params.set("status", status);
      return api<AccountsResponse>(`/api/admin/accounts?${params.toString()}`);
    },
    refetchInterval: 15_000,
    placeholderData: (previousData, previousQuery) => {
      const prevKey = previousQuery?.queryKey;
      if (!previousData || !Array.isArray(prevKey)) return undefined;
      if (prevKey[2] !== debounced || prevKey[3] !== tab) return undefined;
      return previousData;
    },
  });
  const signups = query.data?.signups ?? [];
  const accounts = query.data?.accounts ?? [];
  const totals = query.data?.totals;
  const workspaceCount = totals?.workspaces ?? accounts.length;
  const signupCount = totals?.signups ?? signups.length;
  const abandonedCount = totals?.abandoned ?? (tab === "abandoned" ? signups.length : 0);

  const statusCounts = useMemo(() => {
    const empty: Record<StatusFilter, number> = {
      all: workspaceCount,
      ACTIVE: 0,
      BLOCKED: 0,
      SUSPENDED: 0,
      HOLD: 0,
      DISABLED: 0,
    };
    return { ...empty, ...(totals?.statuses ?? {}) };
  }, [totals?.statuses, workspaceCount]);

  const visibleAccounts = accounts;
  const listTotal =
    tab === "signups" ? signupCount : tab === "abandoned" ? abandonedCount : status === "all" ? workspaceCount : statusCounts[status];
  const setPage =
    tab === "signups" ? setSignupPage : tab === "abandoned" ? setAbandonedPage : setWorkspacePage;

  const visibleFilters = STATUS_FILTERS.filter((filter) => filter.id === "all" || statusCounts[filter.id] > 0);

  return (
    <div className="space-y-4">
      <PageHeader
        className="gap-3 sm:items-center"
        title="Accounts"
        description={
          query.isLoading
            ? "Loading workspaces and signups"
            : `${formatNumber(workspaceCount)} workspace${workspaceCount === 1 ? "" : "s"} · ${formatNumber(signupCount)} signup${signupCount === 1 ? "" : "s"} · ${formatNumber(abandonedCount)} abandoned`
        }
        actions={
          <label className="relative block w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              placeholder="Search name, email, WhatsApp, PIN, city…"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="h-9 pl-9 shadow-none"
            />
          </label>
        }
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex min-w-0 flex-col gap-3 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid w-full min-w-0 grid-cols-3 rounded-lg bg-surface-soft p-0.5 sm:max-w-xl sm:flex-1">
            {(
              [
                { id: "workspaces", label: "Workspaces", count: workspaceCount, icon: Building2 },
                { id: "signups", label: "Signups", count: signupCount, icon: UserPlus },
                { id: "abandoned", label: "Abandoned", count: abandonedCount, icon: MailWarning },
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
                    "inline-flex min-w-0 w-full items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors sm:gap-1.5 sm:px-2.5 sm:text-sm",
                    active ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 text-[11px] tabular-nums",
                      active ? "bg-surface-soft text-ink" : "bg-card text-muted",
                      (item.id === "signups" || item.id === "abandoned") &&
                        item.count > 0 &&
                        !active &&
                        "bg-rose-100 text-brand-dark"
                    )}
                  >
                    {formatNumber(item.count)}
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
                    onClick={() => {
                      setStatus(filter.id);
                      setWorkspacePage(1);
                    }}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
                      active ? "bg-ink text-white" : "bg-surface-soft text-muted hover:text-ink"
                    )}
                  >
                    {filter.label}
                    <span className="ml-1 opacity-70">{formatNumber(statusCounts[filter.id])}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="hidden text-xs text-muted sm:block">
              {tab === "abandoned"
                ? "Started signup and have not confirmed email yet."
                : "People who registered, with or without a workspace."}
            </p>
          )}
        </div>

        {query.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : tab === "signups" || tab === "abandoned" ? (
          signups.length === 0 ? (
            <EmptyState
              icon={tab === "abandoned" ? MailWarning : UserPlus}
              title={
                debounced
                  ? tab === "abandoned"
                    ? "No abandoned signups match"
                    : "No signups match"
                  : tab === "abandoned"
                    ? "No abandoned signups"
                    : "No new signups"
              }
              description={
                debounced
                  ? "Try a different name, email, WhatsApp, PIN, or city."
                  : tab === "abandoned"
                    ? "People who start signup but have not confirmed email will appear here."
                    : "New registrations will appear here."
              }
              className="border-0 py-12 shadow-none"
            />
          ) : (
            <div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-soft/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">Person</th>
                    <th className="px-3 py-2">Active</th>
                    <th className="hidden px-3 py-2 sm:table-cell">WhatsApp</th>
                    <th className="hidden px-3 py-2 sm:table-cell">PIN</th>
                    <th className="hidden px-3 py-2 sm:table-cell">City</th>
                    <th className="px-3 py-2">Workspace</th>
                    <th className="hidden px-3 py-2 md:table-cell">Created</th>
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
                      <ActiveTimeCell lastActiveAt={signup.lastActiveAt} now={now} />
                      <td className="hidden whitespace-nowrap px-3 py-2 tabular-nums text-muted sm:table-cell">
                        {signup.whatsappNumber || "—"}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 tabular-nums text-muted sm:table-cell">
                        {signup.pincode || "—"}
                      </td>
                      <td className="hidden px-3 py-2 text-muted sm:table-cell">
                        {signup.city || "—"}
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
                      <td className="hidden whitespace-nowrap px-3 py-2 text-xs md:table-cell">
                        <div className="tabular-nums text-ink">{formatDate(signup.createdAt, true)}</div>
                        <div className="text-muted">{formatRelative(signup.createdAt)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <AccountsPager page={page} pageSize={ADMIN_ACCOUNT_PAGE_SIZE} total={listTotal} onPageChange={setPage} />
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
          <div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-soft/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="hidden px-3 py-2 sm:table-cell">Plan</th>
                  <th className="px-3 py-2">Active</th>
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
                    <ActiveTimeCell lastActiveAt={account.lastActiveAt} now={now} />
                    <td
                      className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted md:table-cell"
                      title={formatDate(account.created_at)}
                    >
                      {formatRelative(account.created_at)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <AccountAdminActions
                        accountId={account.id}
                        accountName={account.name}
                        currentPlanId={account.subscription?.plan_id}
                        currentBillingCycle={account.subscription?.billing_cycle}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
              <AccountsPager page={page} pageSize={ADMIN_ACCOUNT_PAGE_SIZE} total={listTotal} onPageChange={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}
