"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatPaise } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";

type AdminPackage = {
  id: string;
  slug: string;
  name: string;
  credits: number;
  pricePaise: number;
  isActive: boolean;
  isRecommended: boolean;
  displayOrder: number;
};

type Catalog = {
  packages: AdminPackage[];
  custom: { min: number; max: number };
};

type FormValue = {
  name: string;
  credits: string;
  rupees: string;
  displayOrder: string;
  isRecommended: boolean;
};

const emptyForm = (): FormValue => ({
  name: "",
  credits: "500",
  rupees: "99",
  displayOrder: "10",
  isRecommended: false,
});

export default function AdminAiCreditsPage() {
  const client = useQueryClient();
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [active, setActive] = useState<AdminPackage | null>(null);
  const [form, setForm] = useState<FormValue>(emptyForm);
  const [customMin, setCustomMin] = useState("");
  const [customMax, setCustomMax] = useState("");

  const query = useQuery({
    queryKey: ["admin", "ai-credits"],
    queryFn: () => api<Catalog>("/api/admin/ai-credits"),
  });
  const packages = query.data?.packages ?? [];
  const custom = query.data?.custom;

  const save = useMutation({
    mutationFn: (input: { id?: string; body: Record<string, unknown> }) =>
      input.id
        ? api(`/api/admin/ai-credits/${input.id}`, { method: "PUT", body: JSON.stringify(input.body) })
        : api("/api/admin/ai-credits", { method: "POST", body: JSON.stringify(input.body) }),
    onSuccess: (_data, variables) => {
      toast.success(variables.id ? "Package saved." : "Package created.");
      closeDialog();
      client.invalidateQueries({ queryKey: ["admin", "ai-credits"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggle = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      api(`/api/admin/ai-credits/${input.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: input.isActive }),
      }),
    onSuccess: () => {
      toast.success("Package updated.");
      client.invalidateQueries({ queryKey: ["admin", "ai-credits"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveLimits = useMutation({
    mutationFn: () =>
      api("/api/admin/ai-credits/settings", {
        method: "PATCH",
        body: JSON.stringify({
          customMin: Number(customMin || custom?.min),
          customMax: Number(customMax || custom?.max),
        }),
      }),
    onSuccess: () => {
      toast.success("Custom credit limits saved.");
      client.invalidateQueries({ queryKey: ["admin", "ai-credits"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function closeDialog() {
    setDialog(null);
    setActive(null);
    setForm(emptyForm());
  }

  function openEdit(pack: AdminPackage) {
    setActive(pack);
    setForm({
      name: pack.name,
      credits: String(pack.credits),
      rupees: String(Math.round(pack.pricePaise / 100)),
      displayOrder: String(pack.displayOrder),
      isRecommended: pack.isRecommended,
    });
    setDialog("edit");
  }

  function submit() {
    save.mutate({
      id: dialog === "edit" ? active?.id : undefined,
      body: {
        name: form.name.trim(),
        credits: Math.trunc(Number(form.credits)),
        pricePaise: Math.round(Number(form.rupees) * 100),
        displayOrder: Math.trunc(Number(form.displayOrder) || 0),
        isRecommended: form.isRecommended,
      },
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Credits"
        description="Package prices are charged through Razorpay. Merchants never set the payable amount."
        actions={
          <Button size="sm" onClick={() => setDialog("create")}>
            <Plus />
            New package
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardDescription>Custom credits</CardDescription>
          <CardTitle className="text-base">Minimum and maximum</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="custom-min">Minimum</Label>
            <Input
              id="custom-min"
              type="number"
              min={1}
              className="w-32"
              value={customMin || String(custom?.min ?? 500)}
              onChange={(event) => setCustomMin(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custom-max">Maximum</Label>
            <Input
              id="custom-max"
              type="number"
              min={1}
              className="w-32"
              value={customMax || String(custom?.max ?? 10000)}
              onChange={(event) => setCustomMax(event.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => saveLimits.mutate()} disabled={saveLimits.isPending}>
            {saveLimits.isPending ? "Saving…" : "Save limits"}
          </Button>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : query.isError ? (
        <EmptyState
          icon={Sparkles}
          title="AI credits unavailable"
          description={query.error instanceof Error ? query.error.message : "Try again shortly."}
        />
      ) : packages.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No packages"
          description="Create the first AI credit pack merchants can buy."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-soft/60 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Package</th>
                <th className="px-4 py-2.5">Credits</th>
                <th className="px-4 py-2.5">Price</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((pack) => (
                <tr key={pack.id} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{pack.name}</span>
                      {pack.isRecommended ? (
                        <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-white">
                          Recommended
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted">{pack.slug}</p>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{formatNumber(pack.credits)}</td>
                  <td className="px-4 py-2.5">{formatPaise(pack.pricePaise)}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge value={pack.isActive ? "ACTIVE" : "ARCHIVED"} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(pack)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => toggle.mutate({ id: pack.id, isActive: !pack.isActive })}
                      disabled={toggle.isPending}
                    >
                      {pack.isActive ? "Archive" : "Activate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "edit" ? "Edit package" : "New package"}</DialogTitle>
            <DialogDescription>Prices are stored in paise and used at checkout.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pack-name">Name</Label>
              <Input
                id="pack-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pack-credits">Credits</Label>
                <Input
                  id="pack-credits"
                  type="number"
                  min={1}
                  value={form.credits}
                  onChange={(event) => setForm((current) => ({ ...current, credits: event.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pack-price">Price (₹)</Label>
                <Input
                  id="pack-price"
                  type="number"
                  min={1}
                  value={form.rupees}
                  onChange={(event) => setForm((current) => ({ ...current, rupees: event.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pack-order">Display order</Label>
                <Input
                  id="pack-order"
                  type="number"
                  value={form.displayOrder}
                  onChange={(event) => setForm((current) => ({ ...current, displayOrder: event.target.value }))}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isRecommended}
                onChange={(event) => setForm((current) => ({ ...current, isRecommended: event.target.checked }))}
              />
              Recommended (Most popular)
            </label>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={save.isPending || !form.name.trim()}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
