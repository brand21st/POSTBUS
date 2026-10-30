"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";
import { AiCreditsSection, type AiCreditsPayload } from "@/components/billing/ai-credits-section";
import { PlanPicker, type PublicPlan } from "@/components/billing/plan-picker";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatNumber, formatPaise } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { subscriptionCoverageEnded } from "@/modules/billing/usage";

type BillingPayload = {
  configurationRequired?: boolean;
  plan?: (PublicPlan & { id?: string; slug?: string; description?: string | null; features?: string[] }) | null;
  subscription?: {
    status?: string;
    billingCycle?: "monthly" | "yearly";
    amountPaise?: number;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    renewsAt?: string | null;
    expiresAt?: string | null;
    cancelAtPeriodEnd?: boolean;
    trialEnd?: string | null;
    razorpaySubscriptionId?: string | null;
    coverageEnded?: boolean;
  } | null;
  usage?: {
    quantity?: number;
    limit?: number | null;
    remaining?: number | null;
  } | null;
};

export default function BillingPage() {
  const client = useQueryClient();
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const billing = useQuery({
    queryKey: ["billing", "subscription"],
    queryFn: () => api<BillingPayload>("/api/v1/billing/subscription"),
  });
  const plans = useQuery({
    queryKey: ["billing", "plans"],
    queryFn: () => api<{ plans: PublicPlan[] }>("/api/v1/billing/plans"),
  });
  const payments = useQuery({
    queryKey: ["billing", "payments"],
    queryFn: () =>
      api<{
        payments: Array<{ id: string; amount_paise: number; status: string; created_at: string; razorpay_payment_id?: string }>;
      }>("/api/v1/billing/payments"),
  });
  const aiCredits = useQuery({
    queryKey: ["ai-credits"],
    queryFn: () => api<AiCreditsPayload>("/api/v1/ai-credits"),
  });
  const invoices = useQuery({
    queryKey: ["billing", "invoices"],
    queryFn: () =>
      api<{
        invoices: Array<{ id: string; number?: string; amount?: number; amount_paise?: number; status?: string; issued_at?: string }>;
      }>("/api/v1/billing/invoices"),
  });

  const cancel = useMutation({
    mutationFn: () => api("/api/v1/billing/cancel", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      toast.success("Subscription will remain active until the paid period ends.");
      client.invalidateQueries({ queryKey: ["billing"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const resume = useMutation({
    mutationFn: () => api("/api/v1/billing/resume", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      toast.success("Subscription resumed.");
      client.invalidateQueries({ queryKey: ["billing"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = billing.data;
  const used = data?.usage?.quantity ?? 0;
  const limit = data?.usage?.limit ?? 0;
  const remaining = data?.usage?.remaining ?? Math.max(0, limit - used);
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const catalogPlan = (plans.data?.plans ?? []).find(
    (plan) => plan.id === data?.plan?.id || plan.slug === data?.plan?.slug
  );
  const currentPlanName = catalogPlan?.name ?? data?.plan?.name ?? "No plan";
  const onTrial = data?.subscription?.status === "TRIAL" && !data.subscription.coverageEnded;
  const coverageEnded = Boolean(
    data?.subscription?.coverageEnded ||
      (data?.subscription &&
        subscriptionCoverageEnded({
          status: data.subscription.status,
          current_period_end: data.subscription.currentPeriodEnd,
          expires_at: data.subscription.expiresAt,
          trial_end: data.subscription.trialEnd,
          cancel_at_period_end: data.subscription.cancelAtPeriodEnd,
          razorpay_subscription_id: data.subscription.razorpaySubscriptionId,
        }))
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description="Choose a plan and pay with Razorpay. One-time checkout covers the selected period." />

      {billing.isLoading ? (
        <Skeleton className="h-40" />
      ) : billing.isError ? (
        <EmptyState
          icon={CreditCard}
          title="Billing unavailable"
          description={billing.error instanceof Error ? billing.error.message : "Try again shortly."}
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription>Current plan</CardDescription>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {currentPlanName}
                  {catalogPlan || data?.plan ? (
                    <span className="rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-semibold text-white">
                      {coverageEnded ? "Period ended" : "Current plan"}
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <StatusBadge value={data?.subscription?.status} />
                <p className="capitalize text-muted">{data?.subscription?.billingCycle ?? "monthly"} billing</p>
                <p>{formatPaise(data?.subscription?.amountPaise)}</p>
                {data?.subscription?.status === "TRIAL" ? (
                  <p className="text-muted">{data.plan?.description ?? "3-day trial with every PostBus feature unlocked."}</p>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Usage</CardDescription>
                <CardTitle>
                  Orders used: {formatNumber(used)} / {limit ? formatNumber(limit) : "—"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-2 overflow-hidden rounded-full bg-surface-soft">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
                </div>
                <p className="mt-2 text-sm text-muted">Remaining: {formatNumber(remaining)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>{onTrial ? "Trial ends" : coverageEnded ? "Period ended" : "Next payment"}</CardDescription>
                <CardTitle className="text-base">{formatDate(onTrial ? data?.subscription?.trialEnd ?? data?.subscription?.currentPeriodEnd : coverageEnded ? data?.subscription?.currentPeriodEnd : data?.subscription?.renewsAt ?? data?.subscription?.currentPeriodEnd)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {onTrial ? <p>No payment is taken during the trial.</p> : coverageEnded ? <p>Pay again to continue this plan.</p> : <p>Renewal {formatPaise(data?.subscription?.amountPaise)}</p>}
                <p className="text-muted">
                  Period {formatDate(data?.subscription?.currentPeriodStart)} – {formatDate(data?.subscription?.currentPeriodEnd)}
                </p>
              </CardContent>
            </Card>
          </div>

          <AiCreditsSection credits={aiCredits.data} />

          {data?.subscription?.status === "TRIAL" && (data.plan?.features?.length ?? 0) > 0 ? (
            <Card>
              <CardHeader>
                <CardDescription>Trial access</CardDescription>
                <CardTitle className="text-base">Full features unlocked for 3 days</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm text-ink sm:grid-cols-2">
                  {data.plan?.features?.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {coverageEnded ? null : data?.subscription?.cancelAtPeriodEnd &&
            data.subscription.status !== "TRIAL" ? (
              <Button variant="secondary" onClick={() => resume.mutate()} disabled={resume.isPending}>
                Resume subscription
              </Button>
            ) : data?.subscription ? (
              <Button variant="secondary" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                Cancel subscription
              </Button>
            ) : null}
          </div>

          <div id="plans">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink">Pay for a plan</h2>
              <div className="inline-flex rounded-full border border-border bg-card p-1 text-sm">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 ${cycle === "monthly" ? "bg-brand text-white" : "text-muted"}`}
                  onClick={() => setCycle("monthly")}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 ${cycle === "yearly" ? "bg-brand text-white" : "text-muted"}`}
                  onClick={() => setCycle("yearly")}
                >
                  Yearly · 20% OFF
                </button>
              </div>
            </div>
            <PlanPicker
              plans={plans.data?.plans ?? []}
              cycle={cycle}
              cta="checkout"
              currentPlanId={data?.plan?.id}
              currentPlanSlug={data?.plan?.slug}
              currentCycle={data?.subscription?.billingCycle}
              subscriptionStatus={data?.subscription?.status}
              coverageEnded={coverageEnded}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Payment history</CardTitle>
            </CardHeader>
            <CardContent>
              {(payments.data?.payments ?? []).length === 0 ? (
                <p className="text-sm text-muted">No payments yet.</p>
              ) : (
                <div className="max-h-80 overflow-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="pb-3">Amount</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Reference</th>
                      <th className="pb-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(payments.data?.payments ?? []).map((payment) => (
                      <tr key={payment.id} className="border-t border-border">
                        <td className="py-3">{formatPaise(payment.amount_paise)}</td>
                        <td className="py-3">
                          <StatusBadge value={payment.status} />
                        </td>
                        <td className="py-3 font-mono text-xs">{payment.razorpay_payment_id ?? payment.id.slice(0, 8)}</td>
                        <td className="py-3">{formatDate(payment.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </CardContent>
          </Card>

          {(invoices.data?.invoices ?? []).length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="max-h-64 overflow-auto">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="pb-3">Number</th>
                      <th className="pb-3">Amount</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Issued</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invoices.data?.invoices ?? []).map((invoice) => (
                      <tr key={invoice.id} className="border-t border-border">
                        <td className="py-3">{invoice.number ?? invoice.id.slice(0, 8)}</td>
                        <td className="py-3">{formatPaise(invoice.amount_paise) !== "—" ? formatPaise(invoice.amount_paise) : formatPaise(Number(invoice.amount ?? 0) * 100)}</td>
                        <td className="py-3">
                          <StatusBadge value={invoice.status} />
                        </td>
                        <td className="py-3">{formatDate(invoice.issued_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
            </CardContent>
          </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
