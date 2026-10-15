"use client";

import type { SyntheticEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/dashboard/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { shopifyPendingBookingBlocked } from "@/lib/dashboard/records";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import type { OrderRecord } from "@/types/api";

type PaymentType = "PREPAID" | "COD";

export function ShopifyPaymentConfirm({ order }: { order: OrderRecord }) {
  const queryClient = useQueryClient();
  const payment = order.paymentStatus ?? order.payment_status;
  const blocked = shopifyPendingBookingBlocked(order);

  const confirm = useMutation({
    mutationFn: (paymentType: PaymentType) =>
      api(`/api/v1/orders/${order.id}/shopify-payment`, {
        method: "POST",
        body: JSON.stringify({ paymentType }),
      }),
    onSuccess: () => {
      toast.success("Shopify payment confirmed.");
      queryClient.invalidateQueries({ queryKey: ["order", order.id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const stopRowClick = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  if (!blocked) {
    return <StatusBadge value={payment} />;
  }

  return (
    <div className="inline-flex" onClick={stopRowClick} onPointerDown={stopRowClick}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={confirm.isPending}
            aria-label="Confirm Shopify payment"
            title="Confirm Shopify payment before India Post booking"
            className={cn(
              "inline-flex h-[22px] items-center gap-0.5 rounded-full border-transparent bg-red-100 pl-2 pr-1 text-xs font-medium tracking-wide text-red-800",
              "outline-none transition-colors hover:bg-red-200/80",
              "focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
              "disabled:pointer-events-none disabled:opacity-60",
              "data-[state=open]:bg-red-200/80"
            )}
          >
            Pending
            {confirm.isPending ? (
              <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
            ) : (
              <ChevronDown className="size-3 shrink-0 opacity-70" aria-hidden />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          className="min-w-[8.5rem] p-1"
        >
          <DropdownMenuItem
            className="h-8 rounded-md px-2.5 text-xs font-medium"
            disabled={confirm.isPending}
            onSelect={() => confirm.mutate("PREPAID")}
          >
            Prepaid
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-8 rounded-md px-2.5 text-xs font-medium"
            disabled={confirm.isPending}
            onSelect={() => confirm.mutate("COD")}
          >
            COD
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
