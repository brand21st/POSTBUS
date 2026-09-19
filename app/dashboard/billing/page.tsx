"use client";

import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import type { BillingResponse } from "@/types/api";

export default function BillingPage() {
  const query = useQuery({
    queryKey: ["billing"],
    queryFn: () => api<BillingResponse>("/api/v1/billing"),
  });

  const data = query.data;
  const configurationRequired = Boolean(
    data?.configurationRequired ?? data?.configuration_required
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="Plans, usage, and invoices from the organization subscription record."
      />

      {query.isLoading ? (
        <Skeleton className="h-40" />
      ) : query.isError ? (
        <EmptyState
          icon={CreditCard}
          title="Billing unavailable"
          description={query.error instanceof Error ? query.error.message : "Try again shortly."}
        />
      ) : configurationRequired ? (
        <EmptyState
          icon={CreditCard}
          title="Billing configuration required"
          description="Usage and plan records are stored, but payment collection is not configured for this environment yet."
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription>Plan</CardDescription>
                <CardTitle>{data?.plan?.name ?? data?.plan?.code ?? "—"}</CardTitle>
              </CardHeader>
              <CardContent>
                <StatusBadge value={data?.subscription?.status} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Usage</CardDescription>
                <CardTitle>
                  {formatNumber(data?.usage?.quantity)}
                  {data?.usage?.limit ? ` / ${formatNumber(data.usage.limit)}` : ""}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted">
                {data?.usage?.metric ?? "shipments"} this cycle
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Cycle</CardDescription>
                <CardTitle className="text-base">
                  {formatDate(data?.subscription?.billingCycleStart)} –{" "}
                  {formatDate(data?.subscription?.billingCycleEnd)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              {(data?.invoices ?? []).length === 0 ? (
                <p className="text-sm text-muted">No invoices have been issued.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted">
                        <th className="pb-3">Number</th>
                        <th className="pb-3">Amount</th>
                        <th className="pb-3">Status</th>
                        <th className="pb-3">Issued</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.invoices?.map((invoice) => (
                        <tr key={invoice.id} className="border-t border-border">
                          <td className="py-3">{invoice.number ?? invoice.id.slice(0, 8)}</td>
                          <td className="py-3">{formatCurrency(invoice.amount, invoice.currency)}</td>
                          <td className="py-3">
                            <StatusBadge value={invoice.status} />
                          </td>
                          <td className="py-3">{formatDate(invoice.issuedAt ?? invoice.issued_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
