"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calculator } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard/ai-accountant", label: "Overview" },
  { href: "/dashboard/ai-accountant/assistant", label: "Ask AI" },
  { href: "/dashboard/ai-accountant/reports", label: "Reports" },
  { href: "/dashboard/ai-accountant/ledger", label: "Ledger" },
  { href: "/dashboard/ai-accountant/expenses", label: "Expenses" },
  { href: "/dashboard/ai-accountant/gst", label: "GST" },
  { href: "/dashboard/ai-accountant/cod", label: "COD" },
  { href: "/dashboard/ai-accountant/exports", label: "Exports" },
  { href: "/dashboard/ai-accountant/settings", label: "Settings" },
];

type AccessMode = "FULL" | "READ_ONLY" | "NONE";
const AccessContext = createContext<AccessMode>("FULL");

/** True when the add-on has lapsed: pages show data but disable changes. */
export function useReadOnly() {
  return useContext(AccessContext) !== "FULL";
}

export function AccountantShell({ accessMode, children }: { accessMode: AccessMode; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AccessContext.Provider value={accessMode}>
      <div className="space-y-5">
        <PageHeader
          title="AI Accountant"
          description="Books built from your PostBus orders, India Post postage, COD remittances and expenses."
          icon={
            <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface-soft text-brand">
              <Calculator className="size-5" />
            </div>
          }
          actions={accessMode === "READ_ONLY" ? <StatusBadge value="READ_ONLY" /> : null}
        />
        {accessMode === "READ_ONLY" ? (
          <p className="rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Your AI Accountant add-on has lapsed. You can view and export your books; renew it from Integrations to make changes.
          </p>
        ) : null}
        <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 pb-px" aria-label="AI Accountant sections">
          {NAV.map((item) => {
            const active = item.href === "/dashboard/ai-accountant" ? pathname === item.href : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </div>
    </AccessContext.Provider>
  );
}
