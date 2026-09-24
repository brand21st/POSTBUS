"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/hooks/use-api";

type CheckoutResponse = {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  name: string;
  description: string;
  plan: { name: string };
  prefill?: { email?: string; name?: string };
};

type RazorpayCheckout = {
  open: () => void;
  on: (event: string, handler: (response: { error?: { description?: string } }) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
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
      try {
        await loadCheckoutScript();
        if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable.");
        const checkout = new window.Razorpay({
          key: data.keyId,
          amount: data.amountPaise,
          currency: data.currency,
          order_id: data.razorpayOrderId,
          name: data.name,
          description: data.description,
          prefill: data.prefill ?? {},
          handler: async (response: {
            razorpay_payment_id: string;
            razorpay_order_id: string;
            razorpay_signature: string;
          }) => {
            try {
              await api("/api/v1/billing/verify", {
                method: "POST",
                body: JSON.stringify({
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpaySignature: response.razorpay_signature,
                }),
              });
              toast.success("Payment received. Your plan is active.");
              window.location.reload();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not confirm payment.");
            }
          },
        });
        checkout.on("payment.failed", (response) => {
          toast.error(response.error?.description || "Payment failed.");
        });
        checkout.open();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not open Razorpay Checkout.");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Button variant={variant} className="w-full" onClick={() => start.mutate()} disabled={start.isPending}>
      {start.isPending ? "Starting…" : label}
    </Button>
  );
}
