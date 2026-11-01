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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatNumber, formatPaise } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
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
  const [recordsTab, setRecordsTab] = useState("payments");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [invoiceQuery, setInvoiceQuery] = useState({ q: "", status: "", paymentStatus: "", from: "", to: "", page: 1, sort: "date", direction: "desc" });
  const billing = useQuery({
    queryKey: ["billing", "subscription"],
    queryFn: () => api<BillingPayload>("/api/v1/billing/subscription"),
  });
  const plans = useQuery({
    queryKey: ["billing", "plans"],
    queryFn: () => api<{ plans: PublicPlan[]; gstInclusiveLabel?: boolean }>("/api/v1/billing/plans"),
  });
  const payments = useQuery({
    queryKey: ["billing", "payments"],
    queryFn: () =>
      api<{
        payments: Array<{ id: string; amount_paise: number; status: string; created_at: string; razorpay_payment_id?: string; billing_cycle?: string }>;
      }>("/api/v1/billing/payments"),
  });
  const aiCredits = useQuery({
    queryKey: ["ai-credits"],
    queryFn: () => api<AiCreditsPayload>("/api/v1/ai-credits"),
  });
  const profile = useQuery({
    queryKey: ["billing", "profile"],
    queryFn: () => api<{ profile: { legalName: string; address: string; gstin: string } | null; migrationRequired?: boolean }>("/api/v1/billing/profile"),
  });
  const taxInvoices = useQuery({
    queryKey: ["billing", "tax-invoices", invoiceQuery],
    queryFn: () => {
      const params = new URLSearchParams();
      if (invoiceQuery.q) params.set("q", invoiceQuery.q);
      if (invoiceQuery.status) params.set("status", invoiceQuery.status);
      if (invoiceQuery.paymentStatus) params.set("paymentStatus", invoiceQuery.paymentStatus);
      if (invoiceQuery.from) params.set("from", invoiceQuery.from);
      if (invoiceQuery.to) params.set("to", invoiceQuery.to);
      params.set("page", String(invoiceQuery.page));
      params.set("sort", invoiceQuery.sort);
      params.set("direction", invoiceQuery.direction);
      return api<{
        documents: Array<{ paymentId: string; invoiceNumber: string | null; invoiceDate: string; planName: string; billingCycle: string; periodStart: string | null; periodEnd: string | null; grossPaise: number; gstPaise: number | null; paymentStatus: string; invoiceStatus: string; documentTitle: string }>;
        page: number;
        pageSize: number;
        total: number;
      }>(`/api/v1/billing/tax-invoices?${params.toString()}`);
    },
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
  const saveProfile = useMutation({
    mutationFn: (body: { legalName: string; address: string; gstin: string }) => api("/api/v1/billing/profile", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Billing details saved for future invoices.");
      client.invalidateQueries({ queryKey: ["billing", "profile"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  async function downloadInvoicePreview(paymentId: string) {
    const response = await fetch(`/api/v1/billing/tax-invoices/${paymentId}/pdf`);
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("pdf")) {
      toast.error("Invoice preview is unavailable.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const named = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
    link.download = named?.[1] || "invoice-preview.pdf";
    link.click();
    URL.revokeObjectURL(url);
  }

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
                  <p className="text-muted">{data.plan?.description ?? "7-day trial with every PostBus feature unlocked."}</p>
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
                <CardTitle className="text-base">Full features unlocked for 7 days</CardTitle>
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
            {coverageEnded ? null : data?.subscription?.cancelAtPeriodEnd ? (
              <Button variant="secondary" onClick={() => resume.mutate()} disabled={resume.isPending}>
                Resume subscription
              </Button>
            ) : data?.subscription ? (
              <Button
                variant="secondary"
                onClick={() => {
                  if (window.confirm("Cancel your subscription? It stays active until the current period ends.")) cancel.mutate();
                }}
                disabled={cancel.isPending}
              >
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
              inclusiveLabel={plans.data?.gstInclusiveLabel === true}
            />
          </div>

          <Card>
            <form
              key={profile.data?.profile?.legalName ?? "empty"}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                saveProfile.mutate({ legalName: String(form.get("legalName")), address: String(form.get("address")), gstin: String(form.get("gstin") ?? "") });
              }}
            >
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div className="min-w-0 space-y-1">
                  <CardTitle>Billing details</CardTitle>
                  <CardDescription>Used on future invoices only. Saved payments stay as they were.</CardDescription>
                </div>
                <Button type="submit" variant="secondary" size="sm" disabled={saveProfile.isPending || profile.data?.migrationRequired === true}>
                  {saveProfile.isPending ? "Saving…" : "Save"}
                </Button>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="billing-legal-name">Legal name</Label>
                  <Input id="billing-legal-name" name="legalName" required minLength={2} defaultValue={profile.data?.profile?.legalName ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="billing-gstin">GSTIN, if you have one</Label>
                  <Input id="billing-gstin" name="gstin" maxLength={15} defaultValue={profile.data?.profile?.gstin ?? ""} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="billing-address">Billing address</Label>
                  <Textarea id="billing-address" name="address" required minLength={4} rows={2} defaultValue={profile.data?.profile?.address ?? ""} className="min-h-0 py-2" />
                </div>
                {profile.data?.migrationRequired ? <p className="text-sm text-muted sm:col-span-2">Saving billing details is not available yet.</p> : null}
              </CardContent>
            </form>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments and invoices</CardTitle>
              <CardDescription>Payment captures and GST document previews for this workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={recordsTab} onValueChange={setRecordsTab} className="w-full min-w-0">
                <TabsList className="h-10 w-fit overflow-hidden">
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                  <TabsTrigger value="documents">Documents</TabsTrigger>
                </TabsList>
                <TabsContent value="payments" className="mt-4">
                  {payments.isLoading ? (
                    <Skeleton className="h-24" />
                  ) : (payments.data?.payments ?? []).length === 0 ? (
                    <p className="text-sm text-muted">No payments yet.</p>
                  ) : (
                    <div className="max-h-80 overflow-auto">
                      <table className="w-full min-w-[36rem] text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-muted">
                            <th className="pb-3">Amount</th>
                            <th className="pb-3">Status</th>
                            <th className="pb-3">Reference</th>
                            <th className="pb-3">Date</th>
                            <th className="pb-3">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(payments.data?.payments ?? []).map((payment) => (
                            <tr key={payment.id} className="border-t border-border">
                              <td className="py-2.5">{formatPaise(payment.amount_paise)}</td>
                              <td className="py-2.5">
                                <StatusBadge value={payment.status} />
                              </td>
                              <td className="py-2.5 font-mono text-xs">{payment.razorpay_payment_id ?? payment.id.slice(0, 8)}</td>
                              <td className="py-2.5 whitespace-nowrap">{formatDate(payment.created_at)}</td>
                              <td className="py-2.5">
                                {payment.billing_cycle === "ai_credits" ? (
                                  <span className="text-muted">AI credits</span>
                                ) : (
                                  <Button variant="secondary" size="xs" type="button" onClick={() => downloadInvoicePreview(payment.id)}>
                                    Preview
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="documents" className="mt-4 space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                    <form
                      className="flex min-w-0 flex-1 gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        setInvoiceQuery((current) => ({ ...current, q: String(form.get("q") ?? ""), page: 1 }));
                      }}
                    >
                      <Input name="q" defaultValue={invoiceQuery.q} placeholder="Number or payment reference" className="h-9" />
                      <Button type="submit" variant="secondary" size="sm">
                        Search
                      </Button>
                    </form>
                    <div className="inline-flex rounded-full border border-border bg-card p-1 text-sm">
                      {(
                        [
                          { id: "", label: "All" },
                          { id: "ISSUED", label: "Issued" },
                          { id: "PREVIEW", label: "Preview" },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.id || "all"}
                          type="button"
                          className={cn("rounded-full px-3 py-1", invoiceQuery.status === option.id ? "bg-brand text-white" : "text-muted")}
                          onClick={() => setInvoiceQuery((current) => ({ ...current, status: option.id, page: 1 }))}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setFiltersOpen((open) => !open)}>
                      {filtersOpen ? "Hide filters" : "Filters"}
                    </Button>
                  </div>
                  {filtersOpen ? (
                    <form
                      className="grid gap-2 rounded-xl border border-border bg-surface-soft p-3 sm:grid-cols-2 lg:grid-cols-5"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        setInvoiceQuery((current) => ({
                          ...current,
                          paymentStatus: String(form.get("paymentStatus") ?? ""),
                          from: String(form.get("from") ?? ""),
                          to: String(form.get("to") ?? ""),
                          sort: String(form.get("sort") ?? "date"),
                          direction: String(form.get("direction") ?? "desc"),
                          page: 1,
                        }));
                      }}
                    >
                      <select name="paymentStatus" defaultValue={invoiceQuery.paymentStatus} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
                        <option value="">Any payment</option>
                        <option value="CAPTURED">Captured</option>
                        <option value="PENDING">Pending</option>
                        <option value="FAILED">Failed</option>
                        <option value="REFUNDED">Refunded</option>
                      </select>
                      <Input name="from" type="date" defaultValue={invoiceQuery.from} className="h-9" />
                      <Input name="to" type="date" defaultValue={invoiceQuery.to} className="h-9" />
                      <select name="sort" defaultValue={invoiceQuery.sort} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
                        <option value="date">Date</option>
                        <option value="amount">Amount</option>
                      </select>
                      <div className="flex gap-2">
                        <select name="direction" defaultValue={invoiceQuery.direction} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-sm">
                          <option value="desc">Newest first</option>
                          <option value="asc">Oldest first</option>
                        </select>
                        <Button type="submit" variant="secondary" size="sm">
                          Apply
                        </Button>
                      </div>
                    </form>
                  ) : null}
                  {taxInvoices.isLoading ? (
                    <Skeleton className="h-24" />
                  ) : taxInvoices.isError ? (
                    <p role="alert" className="text-sm text-muted">
                      {taxInvoices.error instanceof Error ? taxInvoices.error.message : "Invoice history is unavailable."}
                    </p>
                  ) : (taxInvoices.data?.documents ?? []).length === 0 ? (
                    <p className="text-sm text-muted">No subscription documents match this filter.</p>
                  ) : (
                    <div className="max-h-80 overflow-auto">
                      <table className="w-full min-w-[48rem] text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-muted">
                            <th className="pb-3">Number</th>
                            <th className="pb-3">Date</th>
                            <th className="pb-3">Plan</th>
                            <th className="pb-3">Period</th>
                            <th className="pb-3">Gross</th>
                            <th className="pb-3">GST</th>
                            <th className="pb-3">Payment</th>
                            <th className="pb-3">PDF</th>
                          </tr>
                        </thead>
                        <tbody>
                          {taxInvoices.data?.documents.map((row) => (
                            <tr key={row.paymentId} className="border-t border-border">
                              <td className="py-2.5">{row.invoiceNumber ?? "Preview"}</td>
                              <td className="py-2.5 whitespace-nowrap">{formatDate(row.invoiceDate)}</td>
                              <td className="py-2.5">{row.planName}</td>
                              <td className="py-2.5">{row.periodStart ? `${formatDate(row.periodStart)} – ${formatDate(row.periodEnd)}` : row.billingCycle}</td>
                              <td className="py-2.5">{formatPaise(row.grossPaise)}</td>
                              <td className="py-2.5">{row.gstPaise === null ? "—" : formatPaise(row.gstPaise)}</td>
                              <td className="py-2.5">
                                <StatusBadge value={row.paymentStatus} />
                              </td>
                              <td className="py-2.5">
                                <Button variant="secondary" size="xs" type="button" onClick={() => downloadInvoicePreview(row.paymentId)}>
                                  PDF
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">{taxInvoices.data?.total ?? 0} documents</span>
                    <div className="flex gap-2">
                      <Button type="button" variant="secondary" size="sm" disabled={invoiceQuery.page <= 1} onClick={() => setInvoiceQuery((current) => ({ ...current, page: current.page - 1 }))}>
                        Previous
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={(taxInvoices.data?.page ?? 1) * (taxInvoices.data?.pageSize ?? 10) >= (taxInvoices.data?.total ?? 0)}
                        onClick={() => setInvoiceQuery((current) => ({ ...current, page: current.page + 1 }))}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
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
                          <td className="py-2.5">{invoice.number ?? invoice.id.slice(0, 8)}</td>
                          <td className="py-2.5">{formatPaise(invoice.amount_paise) !== "—" ? formatPaise(invoice.amount_paise) : formatPaise(Number(invoice.amount ?? 0) * 100)}</td>
                          <td className="py-2.5">
                            <StatusBadge value={invoice.status} />
                          </td>
                          <td className="py-2.5">{formatDate(invoice.issued_at)}</td>
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
