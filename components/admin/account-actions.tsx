"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";

type AccountAction = "activate" | "block" | "suspend" | "hold" | "delete";
type PendingAction = Exclude<AccountAction, "activate"> | null;

const ACTION_COPY: Record<Exclude<PendingAction, null>, { title: string; description: string; confirm: string }> = {
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
}: {
  accountId: string;
  accountName?: string;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [pending, setPending] = useState<PendingAction>(null);
  const [pin, setPin] = useState("");

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

  const copy = pending ? ACTION_COPY[pending] : null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => run.mutate({ action: "activate" })} disabled={run.isPending}>
          Activate
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setPending("block")} disabled={run.isPending}>
          Block
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setPending("suspend")} disabled={run.isPending}>
          Suspend
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setPending("hold")} disabled={run.isPending}>
          Hold
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="text-red-700 hover:bg-red-50"
          onClick={() => setPending("delete")}
          disabled={run.isPending}
        >
          Delete
        </Button>
      </div>
      <Dialog
        open={Boolean(pending)}
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
              disabled={pin.length !== 6 || run.isPending || !pending}
              className={pending === "delete" ? "bg-red-600 text-white hover:bg-red-700" : undefined}
              onClick={() => pending && run.mutate({ action: pending, pin })}
            >
              {run.isPending ? "Working…" : copy?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
