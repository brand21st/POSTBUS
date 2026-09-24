"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatPaise } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Overview = {
  totals: Record<string, number>;
  planDistribution: Array<{ name: string; value: number }>;
  revenueSeries: Array<{ date: string; amount: number }>;
};

const COLORS = ["#e11d48", "#0ea5e9", "#8b5cf6", "#14b8a6"];

export default function AdminDashboardPage() {
  const query = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api<Overview>("/api/admin/overview"),
  });
  const totals = query.data?.totals ?? {};

  const cards = [
    ["Total accounts", totals.accounts],
    ["Active accounts", totals.activeAccounts],
    ["Trial accounts", totals.trialAccounts],
    ["Cancelled", totals.cancelledAccounts],
    ["Active subscriptions", totals.activeSubscriptions],
    ["Monthly subs", totals.monthlySubscriptions],
    ["Yearly subs", totals.yearlySubscriptions],
    ["Failed payments", totals.failedPayments],
    ["Expiring (7 days)", totals.expiringSubscriptions],
    ["Orders processed", totals.ordersProcessed],
    ["Orders today", totals.ordersToday],
    ["Orders this month", totals.ordersMonth],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" description="Accounts, subscriptions, revenue, and usage." />
      {query.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader>
                <CardDescription>Revenue collected</CardDescription>
                <CardTitle>{formatPaise(totals.collectedRevenuePaise)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>MRR</CardDescription>
                <CardTitle>{formatPaise(totals.mrrPaise)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>ARR</CardDescription>
                <CardTitle>{formatPaise(totals.arrPaise)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Pending payments</CardDescription>
                <CardTitle>{formatPaise(totals.pendingPaymentsPaise)}</CardTitle>
              </CardHeader>
            </Card>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map(([label, value]) => (
              <Card key={label}>
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  <CardTitle>{formatNumber(value ?? 0)}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Revenue</CardTitle>
                <CardDescription>Collected Razorpay payments, last 30 days.</CardDescription>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={query.data?.revenueSeries ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" hide />
                    <YAxis hide />
                    <Tooltip />
                    <Area type="monotone" dataKey="amount" stroke="#e11d48" fill="#ffe4e6" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Plan distribution</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={query.data?.planDistribution ?? []} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80}>
                      {(query.data?.planDistribution ?? []).map((entry, index) => (
                        <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
