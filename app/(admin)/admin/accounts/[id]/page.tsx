"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AccountAdminActions } from "@/components/admin/account-actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/hooks/use-api";
import { formatDate, formatPaise } from "@/lib/format";

export default function AdminAccountDetailPage() {
  const params = useParams<{ id: string }>();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "account", params.id],
    queryFn: () => api<Record<string, unknown>>(`/api/admin/accounts/${params.id}`),
  });
  const resetUsage = useMutation({
    mutationFn: () => api(`/api/admin/accounts/${params.id}/reset-usage`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      toast.success("Usage reset.");
      client.invalidateQueries({ queryKey: ["admin", "account", params.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const account = query.data?.account as { name?: string; account_status?: string; slug?: string } | undefined;
  const subscription = query.data?.subscription as {
    status?: string;
    billing_cycle?: string;
    amount_paise?: number;
    current_period_end?: string;
    plans?: { name?: string };
  } | null;
  const usage = (query.data?.usage as Array<{ orders_used?: number; order_limit?: number; period_start?: string }>) ?? [];
  const payments = (query.data?.payments as Array<{ id: string; amount_paise?: number; status?: string; created_at?: string }>) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={account?.name ?? "Account"}
        description={account?.slug}
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <AccountAdminActions accountId={params.id} accountName={account?.name} />
            <Button size="sm" variant="secondary" onClick={() => resetUsage.mutate()} disabled={resetUsage.isPending}>
              Reset usage
            </Button>
          </div>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge value={account?.account_status} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>{subscription?.plans?.name ?? "—"}</div>
            <StatusBadge value={subscription?.status} />
            <div className="text-muted">{subscription?.billing_cycle}</div>
            <div>{formatPaise(subscription?.amount_paise)}</div>
            <div>Ends {formatDate(subscription?.current_period_end)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
          </CardHeader>
          <CardContent>
            {usage[0]
              ? `${usage[0].orders_used ?? 0} / ${usage[0].order_limit ?? "—"}`
              : "No usage yet"}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted">No payments.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-border">
                    <td className="py-2">{formatPaise(payment.amount_paise)}</td>
                    <td className="py-2">
                      <StatusBadge value={payment.status} />
                    </td>
                    <td className="py-2">{formatDate(payment.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
