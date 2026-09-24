"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/hooks/use-api";
import { formatNumber, formatPaise } from "@/lib/format";

export default function AdminRevenuePage() {
  const query = useQuery({
    queryKey: ["admin", "revenue"],
    queryFn: () =>
      api<{
        collectedRevenuePaise: number;
        refundsPaise: number;
        failedCount: number;
        arpaPaise: number;
        revenueByPlan: Array<{ name: string; amountPaise: number }>;
        revenueByCycle: Array<{ name: string; amountPaise: number }>;
      }>("/api/admin/revenue"),
  });
  const data = query.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Revenue" description="Collected Razorpay payments versus subscription value." />
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>{formatPaise(data?.collectedRevenuePaise)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Collected</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{formatPaise(data?.refundsPaise)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Refunds</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{formatNumber(data?.failedCount)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Failed payments</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{formatPaise(data?.arpaPaise)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Avg revenue / account</CardContent>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(data?.revenueByPlan ?? []).map((row) => (
              <div key={row.name} className="flex justify-between">
                <span>{row.name}</span>
                <span>{formatPaise(row.amountPaise)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By billing cycle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(data?.revenueByCycle ?? []).map((row) => (
              <div key={row.name} className="flex justify-between">
                <span className="capitalize">{row.name}</span>
                <span>{formatPaise(row.amountPaise)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
