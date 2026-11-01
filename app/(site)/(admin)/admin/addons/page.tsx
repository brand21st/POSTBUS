"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPaise } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";

type CatalogItem = {
  id: string;
  slug: string;
  name: string;
  monthlyPricePaise: number;
  yearlyPricePaise: number;
  includedAssistantQuestions: number;
  isActive: boolean;
};

export default function AdminAddonsPage() {
  const client = useQueryClient();
  const catalog = useQuery({
    queryKey: ["admin", "addons"],
    queryFn: () => api<{ addons: CatalogItem[] }>("/api/admin/addons"),
  });
  const revenue = useQuery({
    queryKey: ["admin", "addons", "revenue"],
    queryFn: () => api<{ capturedPaise: number; capturedCount: number; failedCount: number }>("/api/admin/addons/revenue"),
  });
  const item = catalog.data?.addons[0];
  const [monthly, setMonthly] = useState("");
  const [yearly, setYearly] = useState("");
  const [questions, setQuestions] = useState("");

  const save = useMutation({
    mutationFn: () => {
      if (!item) throw new Error("Catalog is empty.");
      return api(`/api/admin/addons/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          monthlyPricePaise: Math.round(Number(monthly || item.monthlyPricePaise / 100) * 100),
          yearlyPricePaise: Math.round(Number(yearly || item.yearlyPricePaise / 100) * 100),
          includedAssistantQuestions: Number(questions || item.includedAssistantQuestions),
        }),
      });
    },
    onSuccess: () => {
      toast.success("Add-on catalog saved.");
      client.invalidateQueries({ queryKey: ["admin", "addons"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggle = useMutation({
    mutationFn: (isActive: boolean) => {
      if (!item) throw new Error("Catalog is empty.");
      return api(`/api/admin/addons/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      });
    },
    onSuccess: () => {
      toast.success("Availability updated.");
      client.invalidateQueries({ queryKey: ["admin", "addons"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Paid add-ons" description="Prices and availability. This does not change Starter, Pro, or Business plans." />
      <Card>
        <CardHeader>
          <CardTitle>Revenue</CardTitle>
          <CardDescription>Captured add-on payments only.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-6 text-sm">
          <span>{formatPaise(revenue.data?.capturedPaise ?? 0)}</span>
          <span>{revenue.data?.capturedCount ?? 0} captured</span>
          <span>{revenue.data?.failedCount ?? 0} failed</span>
        </CardContent>
      </Card>
      {item ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>{item.name}</CardTitle>
              <CardDescription>{item.slug}</CardDescription>
            </div>
            <StatusBadge value={item.isActive ? "ACTIVE" : "DISABLED"} />
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Monthly rupees</Label>
              <Input value={monthly} placeholder={String(item.monthlyPricePaise / 100)} onChange={(event) => setMonthly(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Yearly rupees</Label>
              <Input value={yearly} placeholder={String(item.yearlyPricePaise / 100)} onChange={(event) => setYearly(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Included assistant questions</Label>
              <Input value={questions} placeholder={String(item.includedAssistantQuestions)} onChange={(event) => setQuestions(event.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => save.mutate()}>Save prices</Button>
              <Button variant="secondary" onClick={() => toggle.mutate(!item.isActive)}>
                {item.isActive ? "Disable sales" : "Enable sales"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
