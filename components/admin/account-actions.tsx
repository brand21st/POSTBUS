"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

type AccountAction = "activate" | "block" | "suspend" | "hold" | "delete";
type PendingAction = Exclude<AccountAction, "activate"> | "change-plan" | null;

type AdminPlan = {
  id: string;
  name: string;
  slug: string;
  isActive?: boolean;
  monthlyOrderLimit?: number;
};

const ACTION_COPY: Record<Exclude<AccountAction, "activate">, { title: string; description: string; confirm: string }> = {
  block: {
    title: "Block this account?",
    description: "The workspace stays in the database but cannot book or process orders until you activate it again.",
    confirm: "Block account",
  },
  suspend: {
    title: "Suspend this account?",
    description: "Members can sign in, but shipping and billing operations are blocked until you activate the account.",
    confirm: "Suspend account",
  },
  hold: {
    title: "Put this account on hold?",
    description: "Temporarily freeze the workspace. Activate later to restore access.",
    confirm: "Hold account",
  },
  delete: {
    title: "Delete this account from the database?",
    description: "This permanently removes the workspace and cascading tenant data. It cannot be undone.",
    confirm: "Delete permanently",
  },
};

export function AccountAdminActions({
  accountId,
  accountName,
  currentPlanId,
  currentBillingCycle,
  layout = "menu",
}: {
  accountId: string;
  accountName?: string;
  currentPlanId?: string | null;
  currentBillingCycle?: "monthly" | "yearly" | string | null;
  layout?: "menu" | "toolbar";
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [pending, setPending] = useState<PendingAction>(null);
  const [pin, setPin] = useState("");
  const [planId, setPlanId] = useState(currentPlanId ?? "");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">(
    currentBillingCycle === "yearly" ? "yearly" : "monthly"
  );

  const plans = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: () => api<{ plans: AdminPlan[] }>("/api/admin/plans"),
    enabled: pending === "change-plan",
  });

  const run = useMutation({
    mutationFn: async (input: { action: AccountAction; pin?: string }) => {
      return api(`/api/admin/accounts/${accountId}/${input.action}`, {
        method: "POST",
        body: JSON.stringify(input.pin ? { pin: input.pin } : {}),
      });
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.action === "delete" ? "Account deleted." : "Account updated.");
      setPending(null);
      setPin("");
      client.invalidateQueries({ queryKey: ["admin", "accounts"] });
      client.invalidateQueries({ queryKey: ["admin", "account", accountId] });
      if (variables.action === "delete") {
        router.push("/admin/accounts");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const switchPlan = useMutation({
    mutationFn: async () => {
      return api(`/api/admin/accounts/${accountId}/change-plan`, {
        method: "POST",
        body: JSON.stringify({ pin, planId, billingCycle }),
      });
    },
    onSuccess: () => {
      toast.success("Plan updated.");
      setPending(null);
      setPin("");
      client.invalidateQueries({ queryKey: ["admin", "accounts"] });
      client.invalidateQueries({ queryKey: ["admin", "account", accountId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openChangePlan = () => {
    setPlanId(currentPlanId ?? "");
    setBillingCycle(currentBillingCycle === "yearly" ? "yearly" : "monthly");
    setPin("");
    setPending("change-plan");
  };

  const copy = pending && pending !== "change-plan" ? ACTION_COPY[pending] : null;
  const catalog = plans.data?.plans ?? [];
  const busy = run.isPending || switchPlan.isPending;

  const statusItems = (
    <>
      {layout === "menu" ? (
        <DropdownMenuItem disabled={busy} onSelect={() => run.mutate({ action: "activate" })}>
          Activate
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem disabled={busy} onSelect={() => setPending("block")}>
        Block
      </DropdownMenuItem>
      <DropdownMenuItem disabled={busy} onSelect={() => setPending("suspend")}>
        Suspend
      </DropdownMenuItem>
      <DropdownMenuItem disabled={busy} onSelect={() => setPending("hold")}>
        Hold
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={busy}
        className="text-red-700 focus:bg-red-50 focus:text-red-800"
        onSelect={() => setPending("delete")}
      >
        Delete permanently
      </DropdownMenuItem>
    </>
  );

  const menuItems = (
    <>
      <DropdownMenuItem disabled={busy} onSelect={openChangePlan}>
        Switch plan
      </DropdownMenuItem>
      {statusItems}
    </>
  );

  return (
    <>
      <div className="flex items-center justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
        {layout === "toolbar" ? (
          <>
            <Button size="sm" variant="secondary" onClick={openChangePlan} disabled={busy}>
              Switch plan
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => run.mutate({ action: "activate" })}
              disabled={busy}
            >
              Activate
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary" disabled={busy}>
                  Manage
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Account controls</DropdownMenuLabel>
                {statusItems}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                disabled={busy}
                className={cn("size-8 text-muted hover:text-ink")}
                aria-label={`Manage ${accountName ?? "account"}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{accountName ?? "Account"}</DropdownMenuLabel>
              {menuItems}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Dialog
        open={pending === "change-plan"}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            setPin("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch plan</DialogTitle>
            <DialogDescription>
              {accountName ? `${accountName}. ` : ""}
              Apply a catalog plan immediately. Enter the 6-digit Super Admin PIN to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`account-plan-${accountId}`}>Plan</Label>
              <select
                id={`account-plan-${accountId}`}
                className="flex h-11 w-full rounded-[var(--radius-input)] border border-border bg-card px-3.5 text-sm"
                value={planId}
                onChange={(event) => setPlanId(event.target.value)}
              >
                <option value="">Select a plan</option>
                {catalog.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                    {plan.isActive === false ? " (archived)" : ""}
                    {plan.monthlyOrderLimit ? ` · ${plan.monthlyOrderLimit.toLocaleString("en-IN")} orders` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`account-cycle-${accountId}`}>Billing cycle</Label>
              <select
                id={`account-cycle-${accountId}`}
                className="flex h-11 w-full rounded-[var(--radius-input)] border border-border bg-card px-3.5 text-sm"
                value={billingCycle}
                onChange={(event) => setBillingCycle(event.target.value as "monthly" | "yearly")}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`account-plan-pin-${accountId}`}>Confirmation PIN</Label>
              <Input
                id={`account-plan-pin-${accountId}`}
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                placeholder="6-digit PIN"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              disabled={pin.length !== 6 || !planId || switchPlan.isPending}
              onClick={() => switchPlan.mutate()}
            >
              {switchPlan.isPending ? "Saving…" : "Switch plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(copy)}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            setPin("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy?.title}</DialogTitle>
            <DialogDescription>
              {accountName ? `${accountName}. ` : ""}
              {copy?.description} Enter the 6-digit Super Admin PIN to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`account-pin-${accountId}`}>Confirmation PIN</Label>
            <Input
              id={`account-pin-${accountId}`}
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              placeholder="6-digit PIN"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              disabled={pin.length !== 6 || run.isPending || !pending || pending === "change-plan"}
              className={pending === "delete" ? "bg-red-600 text-white hover:bg-red-700" : undefined}
              onClick={() => pending && pending !== "change-plan" && run.mutate({ action: pending, pin })}
            >
              {run.isPending ? "Working…" : copy?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
