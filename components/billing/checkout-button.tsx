"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/hooks/use-api";

type CheckoutResponse = {
  keyId: string;
  razorpaySubscriptionId: string;
  amountPaise: number;
  currency: string;
  name: string;
  description: string;
  plan: { name: string };
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadCheckoutScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }
    const existing = document.querySelector("script[src='https://checkout.razorpay.com/v1/checkout.js']");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Could not load Razorpay Checkout.")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Razorpay Checkout."));
    document.body.appendChild(script);
  });
}

export function CheckoutButton({
  planId,
  billingCycle,
  label,
  variant = "primary",
}: {
  planId: string;
  billingCycle: "monthly" | "yearly";
  label: string;
  variant?: "primary" | "secondary";
}) {
  const start = useMutation({
    mutationFn: () =>
      api<CheckoutResponse>("/api/v1/billing/subscribe", {
        method: "POST",
        body: JSON.stringify({ planId, billingCycle }),
      }),
    onSuccess: async (data) => {
      await loadCheckoutScript();
      if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable.");
      const checkout = new window.Razorpay({
        key: data.keyId,
        subscription_id: data.razorpaySubscriptionId,
        name: data.name,
        description: data.description,
        prefill: {},
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_subscription_id: string;
          razorpay_signature: string;
        }) => {
          await api("/api/v1/billing/verify", {
            method: "POST",
            body: JSON.stringify({
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySubscriptionId: response.razorpay_subscription_id,
              razorpaySignature: response.razorpay_signature,
            }),
          });
          toast.success("Subscription activated.");
          window.location.reload();
        },
      });
      checkout.open();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Button variant={variant} className="w-full" onClick={() => start.mutate()} disabled={start.isPending}>
      {start.isPending ? "Starting…" : label}
    </Button>
  );
}
