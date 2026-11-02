"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js";
import { toast } from "sonner";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPaise } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";

type AddonPayload = {
  addon: {
    name: string;
    description: string | null;
    isActive: boolean;
    checkoutMonthlyPaise: number;
    checkoutYearlyPaise: number;
  };
  entitlement: { status: string; accessMode: string; currentPeriodEnd?: string | null };
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, handler: (r: { error?: { description?: string } }) => void) => void };
  }
}

function loadCheckoutScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Razorpay Checkout."));
    document.body.appendChild(script);
  });
}

export function AiAccountantCard() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["addons", "ai-accountant"],
    queryFn: () => api<AddonPayload>("/api/v1/addons/ai-accountant"),
    retry: false,
  });
  const payload = query.data;
  const status = payload?.entitlement.status ?? "NOT_INSTALLED";
  const open = payload?.entitlement.accessMode === "FULL" || payload?.entitlement.accessMode === "READ_ONLY";

  const checkout = useMutation({
    mutationFn: (billingCycle: "monthly" | "yearly") =>
      api<{
        keyId: string;
        razorpayOrderId: string;
        amountPaise: number;
        currency: string;
        name: string;
        description: string;
        prefill?: { email?: string; name?: string };
      }>("/api/v1/addons/ai-accountant/checkout", {
        method: "POST",
        body: JSON.stringify({ billingCycle }),
      }),
    onSuccess: async (data) => {
      await loadCheckoutScript();
      if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable.");
      const checkoutWindow = new window.Razorpay({
        key: data.keyId,
        amount: data.amountPaise,
        currency: data.currency,
        order_id: data.razorpayOrderId,
        name: data.name,
        description: data.description,
        prefill: data.prefill ?? {},
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          await api("/api/v1/billing/verify", {
            method: "POST",
            body: JSON.stringify({
              razorpayPaymentId: response.razorpay_payment_id,
              razorpayOrderId: response.razorpay_order_id,
              razorpaySignature: response.razorpay_signature,
            }),
          });
          posthog.capture("addon_purchase_completed", { addon: "ai-accountant", amount: data.amountPaise / 100 });
          toast.success("AI Accountant is activating.");
          client.invalidateQueries({ queryKey: ["me"] });
          client.invalidateQueries({ queryKey: ["addons"] });
        },
      });
      checkoutWindow.on("payment.failed", (response) => toast.error(response.error?.description || "Payment failed."));
      checkoutWindow.open();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancel = useMutation({
    mutationFn: () => api("/api/v1/addons/ai-accountant/cancel", { method: "POST", body: "{}" }),
    onSuccess: () => {
      toast.success("Cancellation scheduled at period end.");
      client.invalidateQueries({ queryKey: ["me"] });
      client.invalidateQueries({ queryKey: ["addons"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isError || !payload) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>AI Accountant</CardTitle>
            <CardDescription className="mt-1">
              {payload.addon.description} Available on every PostBus plan as a paid add-on.
            </CardDescription>
          </div>
          <StatusBadge value={status} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {formatPaise(payload.addon.checkoutMonthlyPaise)} / month · {formatPaise(payload.addon.checkoutYearlyPaise)} / year
        </p>
        <div className="flex flex-wrap gap-2">
          {open ? (
            <Link href="/dashboard/ai-accountant" className={buttonVariants({ size: "sm" })}>
              Open AI Accountant
            </Link>
          ) : (
            <>
              <Button size="sm" disabled={!payload.addon.isActive || checkout.isPending} onClick={() => checkout.mutate("monthly")}>
                Subscribe monthly
              </Button>
              <Button size="sm" variant="secondary" disabled={!payload.addon.isActive || checkout.isPending} onClick={() => checkout.mutate("yearly")}>
                Subscribe yearly
              </Button>
            </>
          )}
          {status === "ACTIVE" ? (
            <Button size="sm" variant="secondary" onClick={() => cancel.mutate()}>
              Cancel
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
