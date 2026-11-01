"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/hooks/use-api";
import { formatNumber, formatPaise } from "@/lib/format";

export default function AdminRazorpayPage() {
  const query = useQuery({
    queryKey: ["admin", "razorpay"],
    queryFn: () =>
      api<{
        connected: boolean;
        keyIdMasked: string;
        webhookConfigured: boolean;
        mode: string;
        totals: { payments: number; captured: number; failed: number; refunds: number; revenuePaise: number };
        recent: Array<{ id: string; amount_paise: number; status: string; razorpay_payment_id?: string }>;
      }>("/api/admin/razorpay"),
  });
  const data = query.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Razorpay" description="Connection status and recent subscription payments. The secret key is never shown." />
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>{data?.connected ? "Connected" : "Not configured"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">API keys</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{data?.keyIdMasked || "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Key ID</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{data?.webhookConfigured ? "Configured" : "Missing"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Webhook secret</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="capitalize">{data?.mode ?? "test"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Mode</CardContent>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>{formatNumber(data?.totals.payments)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Payments</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{formatNumber(data?.totals.captured)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Captured</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{formatNumber(data?.totals.failed)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Failed</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{formatPaise(data?.totals.revenuePaise)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Payment revenue</CardContent>
        </Card>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.recent ?? []).map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs">{row.razorpay_payment_id ?? row.id.slice(0, 8)}</td>
                <td className="px-4 py-3">{formatPaise(row.amount_paise)}</td>
                <td className="px-4 py-3">
                  <StatusBadge value={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
