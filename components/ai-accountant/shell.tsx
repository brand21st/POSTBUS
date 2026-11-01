"use client";

import { Fragment, createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Calculator, CheckCircle2, Circle, Settings2 } from "lucide-react";
import { FEATURES, FEATURE_GROUPS, GLOSSARY, SETUP_STEP_COPY, featureFor } from "@/components/ai-accountant/features";
import { SideSheet } from "@/components/dashboard/side-sheet";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

type AccessMode = "FULL" | "READ_ONLY" | "NONE";

export type AccountantStatus = {
  accessMode: AccessMode;
  addon: { status: string; currentPeriodEnd: string | null };
  quota: { included: number; used: number; remaining: number };
  gst: { registered: boolean | null; gstin: string | null };
  lastSyncedAt: string | null;
  counts: { activeProducts: number; productsMissingRate: number; productsMissingCost: number; codToReview: number };
  setup: { steps: Array<{ key: string; done: boolean }>; done: number; total: number };
};

const AccessContext = createContext<AccessMode>("FULL");

/** True when the add-on has lapsed: pages show data but disable changes. */
export function useReadOnly() {
  return useContext(AccessContext) !== "FULL";
}

/** Shared status (badges, quota, setup). Any ["ai-accountant"] invalidation refreshes it. */
export function useAccountantStatus() {
  return useQuery({
    queryKey: ["ai-accountant", "status"],
    queryFn: () => api<AccountantStatus>("/api/v1/ai-accountant/status"),
    staleTime: 30_000,
  });
}

function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium",
        tone === "good" && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
        tone === "neutral" && "border-border bg-card text-muted"
      )}
    >
      {children}
    </span>
  );
}

function badgeFor(key: string, status?: AccountantStatus): string | null {
  if (!status) return null;
  if (key === "overview" && status.setup.done < status.setup.total) return `${status.setup.done}/${status.setup.total}`;
  if (key === "cod" && status.counts.codToReview) return String(status.counts.codToReview);
  if (key === "gst" && status.counts.productsMissingRate && !status.setup.steps.find((s) => s.key === "tax_rates")?.done) {
    return String(status.counts.productsMissingRate);
  }
  if (key === "assistant" && status.quota.included) return `${status.quota.remaining}`;
  return null;
}

function GuideSheet({ open, onClose, status }: { open: boolean; onClose: () => void; status?: AccountantStatus }) {
  return (
    <SideSheet open={open} onClose={onClose} title="AI Accountant guide" description="Every feature, where its settings live, and what the terms mean.">
      <div className="space-y-6 text-sm">
        {status && status.setup.done < status.setup.total ? (
          <section className="space-y-2">
            <h3 className="font-semibold text-ink">
              Setup · {status.setup.done} of {status.setup.total} done
            </h3>
            {status.setup.steps.map((step) => {
              const copy = SETUP_STEP_COPY[step.key]!;
              return (
                <Link key={step.key} href={copy.href} onClick={onClose} className="flex items-start gap-2 rounded-lg p-1.5 hover:bg-surface-soft">
                  {step.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted" />}
                  <span>
                    <span className={cn("block", step.done ? "text-muted line-through" : "text-ink")}>{copy.title}</span>
                    {!step.done ? <span className="block text-xs text-muted">{copy.why}</span> : null}
                  </span>
                </Link>
              );
            })}
          </section>
        ) : null}
        {FEATURE_GROUPS.map((group) => (
          <section key={group} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{group}</h3>
            {FEATURES.filter((f) => f.group === group).map((feature) => (
              <Link key={feature.key} href={feature.href} onClick={onClose} className="flex gap-3 rounded-xl border border-border p-3 hover:bg-surface-soft">
                <feature.icon className="mt-0.5 size-4 shrink-0 text-brand" />
                <span className="min-w-0 space-y-1">
                  <span className="block font-medium text-ink">{feature.label}</span>
                  <span className="block text-muted">{feature.summary}</span>
                  {feature.configuredIn ? <span className="block text-xs text-muted">Configure in {feature.configuredIn}</span> : null}
                </span>
              </Link>
            ))}
          </section>
        ))}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Who can do what</h3>
          <p className="text-muted">Owners and admins can change books and settings. Managers, operators and viewers can view everything, export and ask the AI.</p>
        </section>
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Terms</h3>
          <dl className="space-y-2">
            {GLOSSARY.map((item) => (
              <div key={item.term}>
                <dt className="font-medium text-ink">{item.term}</dt>
                <dd className="text-muted">{item.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </SideSheet>
  );
}

export function AccountantShell({ accessMode, children }: { accessMode: AccessMode; children: ReactNode }) {
  const pathname = usePathname();
  const [guideOpen, setGuideOpen] = useState(false);
  const status = useAccountantStatus().data;
  const current = featureFor(pathname);
  const periodEnd = status?.addon.currentPeriodEnd;

  return (
    <AccessContext.Provider value={accessMode}>
      <div className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-soft text-brand">
              <Calculator className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold leading-tight text-ink sm:text-2xl">AI Accountant</h1>
              <p className="truncate text-xs text-muted sm:text-sm">{current.summary}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {accessMode === "READ_ONLY" ? (
              <Chip tone="warn">Read-only · renew in Integrations</Chip>
            ) : periodEnd ? (
              <Chip tone="good">Active · renews {formatDate(periodEnd)}</Chip>
            ) : null}
            {status?.quota.included ? (
              <Chip>
                {status.quota.remaining}/{status.quota.included} AI questions left
              </Chip>
            ) : null}
            <Button size="xs" variant="secondary" onClick={() => setGuideOpen(true)}>
              <BookOpen className="size-3.5" /> Guide
            </Button>
            <Link
              href="/dashboard/ai-accountant/settings"
              aria-label="AI Accountant settings"
              title="Settings"
              className="flex size-8 items-center justify-center rounded-[var(--radius-input)] border border-border bg-card text-muted hover:text-ink"
            >
              <Settings2 className="size-4" />
            </Link>
          </div>
        </header>

        {accessMode === "READ_ONLY" ? (
          <p className="rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Your add-on has lapsed. You can view and export your books; renew it from Integrations to make changes.
          </p>
        ) : null}

        <nav
          aria-label="AI Accountant sections"
          className="sticky top-16 z-20 -mx-1 flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-border bg-surface/90 px-1 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-surface/75"
        >
          {FEATURE_GROUPS.map((group, index) => (
            <Fragment key={group}>
              {index > 0 ? <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" /> : null}
              {FEATURES.filter((f) => f.group === group).map((item) => {
                const active = item.key === current.key;
                const badge = badgeFor(item.key, status);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={item.summary}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                      active ? "bg-surface-soft font-medium text-ink" : "text-muted hover:bg-surface-soft/60 hover:text-ink"
                    )}
                  >
                    <item.icon className={cn("size-4", active && "text-brand")} />
                    {item.label}
                    {badge ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-[11px] leading-5 tabular-nums",
                          item.key === "assistant" ? "bg-surface-soft text-muted" : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
                        )}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </Fragment>
          ))}
        </nav>
        {children}
      </div>
      <GuideSheet open={guideOpen} onClose={() => setGuideOpen(false)} status={status} />
    </AccessContext.Provider>
  );
}
