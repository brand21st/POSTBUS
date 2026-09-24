"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/hooks/use-api";

export default function AdminTrialPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "trial"],
    queryFn: () => api<{ trial_enabled: boolean; trial_days: number }>("/api/admin/trial-settings"),
  });
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [days, setDays] = useState<string>("");
  const trialEnabled = enabled ?? query.data?.trial_enabled ?? true;
  const trialDays = days || String(query.data?.trial_days ?? 3);
  const save = useMutation({
    mutationFn: () =>
      api("/api/admin/trial-settings", {
        method: "PATCH",
        body: JSON.stringify({ trialEnabled, trialDays: Number(trialDays) }),
      }),
    onSuccess: () => {
      toast.success("Trial settings saved.");
      client.invalidateQueries({ queryKey: ["admin", "trial"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Trial settings" description="New workspaces get a trial with every PostBus feature unlocked. Control whether trials are enabled and for how many days." />
      <Card className="max-w-lg">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="trial-enabled">Trial enabled</Label>
            <Switch id="trial-enabled" checked={trialEnabled} onCheckedChange={setEnabled} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="trial-days">Trial duration (days)</Label>
            <Input id="trial-days" type="number" min={0} max={90} value={trialDays} onChange={(event) => setDays(event.target.value)} />
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
