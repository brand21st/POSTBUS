"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AiCreditsCheckoutButton } from "@/components/billing/ai-credits-checkout-button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatNumber, formatPaise } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import { quoteAiCredits } from "@/modules/ai-credits/quote";

export type AiCreditsPayload = {
  remaining: number;
  purchased?: number;
  used?: number;
  included?: number;
  packSize?: number;
  packPaise?: number;
  packages?: Array<{
    id: string;
    slug: string;
    name: string;
    credits: number;
    pricePaise: number;
    isRecommended?: boolean;
    displayOrder?: number;
  }>;
  custom?: { min: number; max: number };
};

type LedgerPayload = {
  entries: Array<{
    id: string;
    date: string;
    type: string;
    description: string;
    credits: number;
    amountPaise: number | null;
    status: string;
  }>;
};

export function AiCreditsSection({ credits }: { credits?: AiCreditsPayload }) {
  const ledger = useQuery({
    queryKey: ["ai-credits", "ledger"],
    queryFn: () => api<LedgerPayload>("/api/v1/ai-credits/ledger"),
  });
  const packages = useMemo(() => credits?.packages ?? [], [credits?.packages]);
  const custom = useMemo(() => credits?.custom ?? { min: 500, max: 10000 }, [credits?.custom]);
  const recommended = packages.find((item) => item.isRecommended) ?? packages[0];
  const [selectedId, setSelectedId] = useState<string | "custom" | null>(null);
  const [customCredits, setCustomCredits] = useState(String(custom.min));
  const selectedPackageId = selectedId ?? recommended?.id ?? null;
  const isCustom = selectedPackageId === "custom";

  const quote = useMemo(() => {
    try {
      if (isCustom) {
        return quoteAiCredits(Number(customCredits), packages, custom);
      }
      const pack = packages.find((item) => item.id === selectedPackageId);
      if (!pack) return null;
      return quoteAiCredits(pack.credits, packages, custom, pack.id);
    } catch {
      return null;
    }
  }, [custom, customCredits, isCustom, packages, selectedPackageId]);

  const remaining = credits?.remaining ?? 500;
  const purchased = credits?.purchased ?? 0;
  const used = credits?.used ?? 0;

  return (
    <div id="ai-credits" className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">AI Credits</h2>
        <p className="mt-1 text-sm text-muted">
          Turn customer messages into ready-to-book addresses with AI.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Available AI Credits</CardDescription>
            <CardTitle className="tabular-nums text-3xl">{formatNumber(remaining)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Purchased</CardDescription>
            <CardTitle className="tabular-nums">{formatNumber(purchased)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Used</CardDescription>
            <CardTitle className="tabular-nums">{formatNumber(used)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">Choose a package</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {packages.map((pack) => {
            const active = !isCustom && selectedPackageId === pack.id;
            return (
              <button
                key={pack.id}
                type="button"
                onClick={() => setSelectedId(pack.id)}
                className={cn(
                  "rounded-2xl border bg-card p-4 text-left shadow-[0_1px_2px_rgb(9_9_11/0.04)] transition",
                  active ? "border-brand ring-1 ring-brand" : "border-border hover:border-brand/40"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-muted">{pack.name}</p>
                  {pack.isRecommended ? (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      Most popular
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xl font-semibold tabular-nums text-ink">{formatNumber(pack.credits)}</p>
                <p className="mt-1 text-sm text-muted">{formatPaise(pack.pricePaise)}</p>
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardDescription>Need a different amount?</CardDescription>
          <CardTitle className="text-base">Custom credits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted" htmlFor="custom-ai-credits">
                Credits
              </label>
              <Input
                id="custom-ai-credits"
                type="number"
                min={custom.min}
                max={custom.max}
                step={1}
                value={customCredits}
                onChange={(event) => {
                  setCustomCredits(event.target.value);
                  setSelectedId("custom");
                }}
                onFocus={() => setSelectedId("custom")}
                className="w-36"
              />
            </div>
            <div className="text-sm text-muted">
              <p>
                Calculated price:{" "}
                <span className="font-semibold text-ink">{quote ? formatPaise(quote.amountPaise) : "—"}</span>
              </p>
              {quote ? (
                <p className="tabular-nums">₹{quote.perCreditRupees.toFixed(4)} / credit</p>
              ) : (
                <p>
                  Enter {formatNumber(custom.min)}–{formatNumber(custom.max)} whole credits.
                </p>
              )}
            </div>
          </div>
          <AiCreditsCheckoutButton
            packageId={isCustom ? undefined : selectedPackageId ?? undefined}
            credits={isCustom ? Number(customCredits) : undefined}
            disabled={!quote}
            label="Buy AI Credits"
            className="w-full sm:w-auto"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Credit history</CardTitle>
        </CardHeader>
        <CardContent>
          {(ledger.data?.entries ?? []).length === 0 ? (
            <p className="text-sm text-muted">No AI credit movements yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="pb-3">Date</th>
                    <th className="pb-3">Description</th>
                    <th className="pb-3">Credits</th>
                    <th className="pb-3">Amount</th>
                    <th className="pb-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(ledger.data?.entries ?? []).map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="py-3">{formatLedgerDate(row.date)}</td>
                      <td className="py-3">{row.description}</td>
                      <td className="py-3 tabular-nums">
                        {row.credits > 0 ? "+" : ""}
                        {formatNumber(row.credits)}
                      </td>
                      <td className="py-3">{row.amountPaise != null ? formatPaise(row.amountPaise) : "—"}</td>
                      <td className="py-3">
                        <StatusBadge value={ledgerStatus(row)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ledgerStatus(row: { type: string; status: string; credits: number }) {
  if (row.type === "PURCHASE") return "Paid";
  if (row.credits < 0) return "Used";
  return row.status;
}

function formatLedgerDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}
