"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/hooks/use-api";
import { formatPaise } from "@/lib/format";

type Plan = {
  id: string;
  name: string;
  slug: string;
  monthlyPricePaise: number;
  yearlyPricePaise: number;
  monthlyOrderLimit: number;
  isActive: boolean;
};

export default function AdminPlansPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: () => api<{ plans: Plan[] }>("/api/admin/plans"),
  });
  const toggle = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      api(`/api/admin/plans/${input.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: input.isActive }),
      }),
    onSuccess: () => {
      toast.success("Plan updated.");
      client.invalidateQueries({ queryKey: ["admin", "plans"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Plans" description="Activate, archive, and review Razorpay-backed plans. Plans with subscribers are archived, never deleted." />
      <div className="grid gap-4 md:grid-cols-3">
        {(query.data?.plans ?? []).map((plan) => (
          <Card key={plan.id}>
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-ink">{plan.name}</h2>
                <StatusBadge value={plan.isActive ? "ACTIVE" : "ARCHIVED"} />
              </div>
              <p className="text-sm text-muted">{formatPaise(plan.monthlyPricePaise)} / month</p>
              <p className="text-sm text-muted">{formatPaise(plan.yearlyPricePaise)} / year</p>
              <p className="text-sm">{plan.monthlyOrderLimit.toLocaleString("en-IN")} orders / period</p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => toggle.mutate({ id: plan.id, isActive: !plan.isActive })}
              >
                {plan.isActive ? "Archive" : "Activate"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
