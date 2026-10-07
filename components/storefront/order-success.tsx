"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { formatStorePrice } from "@/modules/storefront/pricing";

export type StoreOrderReceipt = {
  orderNumber: string;
  total: number;
  advanceAmount: number;
  codAmount: number;
  paymentMethod: string;
  returnPolicy: string;
};

export function StoreOrderSuccess({
  receipt,
  onContinue,
}: {
  receipt: StoreOrderReceipt;
  onContinue: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onContinue, 2000);
    return () => window.clearTimeout(timer);
  }, [onContinue]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-8 text-center">
      <div className="w-full max-w-sm min-w-0 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-zinc-100 sm:p-8">
        <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 motion-safe:animate-[store-check_520ms_ease-out]">
          <svg viewBox="0 0 24 24" className="size-11" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" className="stroke-emerald-200" strokeWidth="1.5" />
            <path
              d="M7 12.5l3.2 3.2L17 8.8"
              className="stroke-emerald-600 motion-safe:animate-[store-tick_420ms_180ms_ease-out_both]"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Order received successfully</p>
        <h1 className="mt-2 break-words text-2xl font-bold tracking-tight">Thank you for your order!</h1>
        <p className="mt-3 rounded-2xl bg-zinc-50 px-3 py-2 text-sm font-semibold">
          Order {receipt.orderNumber || "received"}
        </p>
        <p className="mt-2 text-sm text-zinc-500">Payment/Order status: Processing</p>
        <dl className="mt-4 space-y-1.5 text-left text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-500">Total</dt>
            <dd className="font-semibold tabular-nums">{formatStorePrice(receipt.total)}</dd>
          </div>
          {receipt.advanceAmount > 0 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Advance</dt>
              <dd className="font-semibold tabular-nums">{formatStorePrice(receipt.advanceAmount)}</dd>
            </div>
          ) : null}
          {receipt.codAmount > 0 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">COD</dt>
              <dd className="font-semibold tabular-nums">{formatStorePrice(receipt.codAmount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-500">Method</dt>
            <dd className="min-w-0 text-right font-medium">{receipt.paymentMethod}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-500">Returns</dt>
            <dd className="min-w-0 text-right font-medium">{receipt.returnPolicy}</dd>
          </div>
        </dl>
        <Button type="button" className="mt-6 h-12 w-full rounded-2xl" onClick={onContinue}>
          Continue shopping
        </Button>
        <style>{`
          @keyframes store-check {
            from { transform: scale(0.72); opacity: 0.4; }
            to { transform: scale(1); opacity: 1; }
          }
          @keyframes store-tick {
            from { stroke-dasharray: 24; stroke-dashoffset: 24; }
            to { stroke-dasharray: 24; stroke-dashoffset: 0; }
          }
        `}</style>
      </div>
    </div>
  );
}
