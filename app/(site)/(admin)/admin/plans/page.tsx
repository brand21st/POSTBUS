"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers3, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  emptyPlanForm,
  formToPayload,
  PlanEditorFields,
  planToForm,
  type AdminPlan,
  type PlanFormValue,
} from "@/components/admin/plan-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/hooks/use-api";
import { formatNumber, formatPaise } from "@/lib/format";

export default function AdminPlansPage() {
  const client = useQueryClient();
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [activePlan, setActivePlan] = useState<AdminPlan | null>(null);
  const [form, setForm] = useState<PlanFormValue>(emptyPlanForm);

  const query = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: () => api<{ plans: AdminPlan[] }>("/api/admin/plans"),
  });

  const plans = query.data?.plans ?? [];
  const metrics = useMemo(() => {
    const live = plans.reduce((sum, plan) => sum + (plan.subscriberCount ?? 0), 0);
    const archived = plans.filter((plan) => !plan.isActive).length;
    const topQuota = Math.max(0, ...plans.map((plan) => plan.monthlyOrderLimit || 0));
    return { count: plans.length, live, archived, topQuota };
  }, [plans]);

  const save = useMutation({
    mutationFn: (input: { id?: string; body: ReturnType<typeof formToPayload> }) =>
      input.id
        ? api(`/api/admin/plans/${input.id}`, { method: "PUT", body: JSON.stringify(input.body) })
        : api("/api/admin/plans", { method: "POST", body: JSON.stringify(input.body) }),
    onSuccess: (_data, variables) => {
      toast.success(variables.id ? "Plan saved." : "Plan created.");
      closeDialog();
      client.invalidateQueries({ queryKey: ["admin", "plans"] });
    },
    onError: (error: Error) => toast.error(error.message),
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

  function closeDialog() {
    setDialog(null);
    setActivePlan(null);
    setForm(emptyPlanForm());
  }

  function openCreate() {
    setActivePlan(null);
    setForm(emptyPlanForm());
    setDialog("create");
  }

  function openEdit(plan: AdminPlan) {
    setActivePlan(plan);
    setForm(planToForm(plan));
    setDialog("edit");
  }

  function submit() {
    save.mutate({
      id: dialog === "edit" ? activePlan?.id : undefined,
      body: formToPayload(form),
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Plans"
        description="Catalog, pricing, and live subscribers. Archive plans that still have subscribers instead of deleting them."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus />
            New plan
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm">
        <Metric label="Plans" value={query.isLoading ? "—" : formatNumber(metrics.count)} />
        <Metric label="Live" value={query.isLoading ? "—" : formatNumber(metrics.live)} />
        <Metric label="Archived" value={query.isLoading ? "—" : formatNumber(metrics.archived)} />
        <Metric
          label="Top quota"
          value={query.isLoading ? "—" : `${formatNumber(metrics.topQuota)} / period`}
        />
      </div>

      {query.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : query.isError ? (
        <EmptyState
          icon={Layers3}
          title="Plans unavailable"
          description={query.error instanceof Error ? query.error.message : "Try again shortly."}
        />
      ) : plans.length === 0 ? (
        <EmptyState
          icon={Layers3}
          title="No plans yet"
          description="Create the first billing plan to start offering subscriptions."
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus />
              New plan
            </Button>
          }
        />
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {plans.map((plan) => (
              <article key={plan.id} className="rounded-2xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-ink">{plan.name}</h2>
                      <span className="text-[11px] text-muted">{plan.slug}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatPaise(plan.monthlyPricePaise)} /mo · {formatNumber(plan.monthlyOrderLimit)} orders ·{" "}
                      {formatNumber(plan.subscriberCount)} live
                    </p>
                  </div>
                  <StatusBadge value={plan.isActive ? "ACTIVE" : "ARCHIVED"} />
                </div>
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(plan)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => toggle.mutate({ id: plan.id, isActive: !plan.isActive })}
                    disabled={toggle.isPending}
                  >
                    {plan.isActive ? "Archive" : "Activate"}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-soft/60 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Plan</th>
                <th className="px-4 py-2.5">Pricing</th>
                <th className="px-4 py-2.5">Orders</th>
                <th className="px-4 py-2.5">Live</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => {
                const extras = (plan.features ?? []).filter(
                  (line) => !/orders per billing period/i.test(line)
                );
                return (
                  <tr key={plan.id} className="border-t border-border hover:bg-surface-soft/40">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{plan.name}</span>
                        <span className="text-[11px] text-muted">{plan.slug}</span>
                      </div>
                      {plan.description ? (
                        <p className="mt-0.5 max-w-sm truncate text-xs text-muted">{plan.description}</p>
                      ) : null}
                      {extras.length ? (
                        <p className="mt-0.5 max-w-sm truncate text-[11px] text-muted">
                          {extras.slice(0, 2).join(" · ")}
                          {extras.length > 2 ? ` · +${extras.length - 2}` : ""}
                        </p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                      <div className="font-medium text-ink">
                        {formatPaise(plan.monthlyPricePaise)}
                        <span className="font-normal text-muted"> /mo</span>
                      </div>
                      <div className="text-xs text-muted">
                        {formatPaise(plan.yearlyPricePaise)} /yr
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                      {formatNumber(plan.monthlyOrderLimit)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                      {formatNumber(plan.subscriberCount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <StatusBadge value={plan.isActive ? "ACTIVE" : "ARCHIVED"} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(plan)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => toggle.mutate({ id: plan.id, isActive: !plan.isActive })}
                          disabled={toggle.isPending}
                        >
                          {plan.isActive ? "Archive" : "Activate"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="flex max-h-[min(90vh,800px)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>{dialog === "edit" ? `Edit ${activePlan?.name}` : "New plan"}</DialogTitle>
            <DialogDescription>
              {dialog === "edit"
                ? `${activePlan?.subscriberCount ?? 0} live ${(activePlan?.subscriberCount ?? 0) === 1 ? "subscription" : "subscriptions"}. Changing price creates new Razorpay plans on the next checkout.`
                : "Name, pricing, order quota, and feature checklist. Order-limit copy is generated automatically."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <PlanEditorFields
              form={form}
              onChange={setForm}
              idPrefix={dialog === "edit" ? "edit-plan" : "create-plan"}
            />
          </div>
          <DialogFooter className="border-t border-border bg-surface-soft/50 px-6 py-3">
            <Button variant="secondary" size="sm" onClick={closeDialog}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={save.isPending || form.name.trim().length < 2}>
              {save.isPending ? "Saving…" : dialog === "edit" ? "Save plan" : "Create plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </p>
  );
}
