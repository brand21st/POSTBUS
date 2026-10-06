"use client";

import type { ReactNode } from "react";
import { ArrowLeft, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { StoreImage } from "@/components/storefront/store-image";
import type { CartLine, StoreProduct } from "@/components/storefront/store-types";
import { formatStorePrice } from "@/modules/storefront/pricing";

export function CartSheet({
  cart,
  accent,
  checkout,
  recommendations,
  checkoutForm,
  onClose,
  onCheckout,
  onBack,
  onAdd,
  onDecrease,
  onRemove,
}: {
  cart: CartLine[];
  accent: string;
  checkout: boolean;
  recommendations: StoreProduct[];
  checkoutForm: ReactNode;
  onClose: () => void;
  onCheckout: () => void;
  onBack: () => void;
  onAdd: (product: StoreProduct) => void;
  onDecrease: (productId: string) => void;
  onRemove: (productId: string) => void;
}) {
  const subtotal = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const compareTotal = cart.reduce(
    (sum, line) => sum + (line.product.compareAtPrice ?? line.product.price) * line.quantity,
    0
  );
  const savings = Math.max(0, compareTotal - subtotal);
  const codEligible = cart.length > 0 && cart.every((line) => line.product.codEnabled);
  const estimatedAdvance = codEligible
    ? Math.round(
        cart.reduce(
          (sum, line) =>
            sum + line.product.price * line.quantity * (line.product.codAdvancePercent ?? 0) / 100,
          0
        ) * 100
      ) / 100
    : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={checkout ? "Checkout" : "Your cart"}>
      <button className="absolute inset-0 cursor-default" type="button" onClick={onClose} aria-label="Close cart" />
      <section className="absolute inset-x-0 bottom-0 flex max-h-[94dvh] w-full flex-col rounded-t-[1.75rem] bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(100%,440px)] sm:max-h-none sm:rounded-none">
        <header className="flex shrink-0 items-center gap-1 border-b border-zinc-100 px-3 py-2.5 sm:gap-2 sm:px-4 sm:py-3">
          {checkout ? (
            <button type="button" className="flex size-11 items-center justify-center rounded-full hover:bg-zinc-100" onClick={onBack} aria-label="Back to cart">
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <span className="flex size-11 items-center justify-center rounded-full bg-zinc-100">
              <ShoppingBag className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-bold">{checkout ? "Delivery details" : "Your cart"}</h2>
            <p className="text-xs text-zinc-500">{cart.reduce((sum, line) => sum + line.quantity, 0)} items</p>
          </div>
          <button type="button" className="flex size-11 items-center justify-center rounded-full hover:bg-zinc-100" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {!cart.length ? (
            <div className="flex min-h-72 flex-col items-center justify-center text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
                <ShoppingBag className="size-7" />
              </span>
              <p className="mt-4 font-bold">Your cart is empty</p>
              <p className="mt-1 max-w-56 text-sm text-zinc-500">Add products you love and they’ll appear here.</p>
              <button type="button" className="mt-5 h-11 rounded-2xl px-6 text-sm font-bold text-white" style={{ backgroundColor: accent }} onClick={onClose}>
                Continue shopping
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {cart.map((line) => (
                  <article key={line.product.id} className="flex gap-3 rounded-2xl border border-zinc-100 bg-white p-2.5 shadow-sm">
                    <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
                      <StoreImage src={line.product.imageUrls[0]} alt="" sizes="80px" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="line-clamp-2 text-sm font-semibold">{line.product.name}</h3>
                          <p className="mt-1 text-sm font-bold">{formatStorePrice(line.product.price)}</p>
                        </div>
                        {!checkout ? (
                          <button type="button" className="flex size-9 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-red-600" onClick={() => onRemove(line.product.id)} aria-label={`Remove ${line.product.name}`}>
                            <Trash2 className="size-4" />
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        {!checkout ? (
                          <div className="flex h-9 items-center rounded-xl border border-zinc-200">
                            <button type="button" className="flex size-9 items-center justify-center active:scale-90" onClick={() => onDecrease(line.product.id)} aria-label={`Decrease ${line.product.name}`}>
                              <Minus className="size-3.5" />
                            </button>
                            <span className="w-7 text-center text-sm font-bold tabular-nums">{line.quantity}</span>
                            <button type="button" className="flex size-9 items-center justify-center active:scale-90" onClick={() => onAdd(line.product)} aria-label={`Increase ${line.product.name}`}>
                              <Plus className="size-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-500">Qty {line.quantity}</span>
                        )}
                        <span className="text-sm font-bold">{formatStorePrice(line.product.price * line.quantity)}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              {!checkout && recommendations.length ? (
                <section className="mt-6">
                  <h3 className="font-bold">You may also like</h3>
                  <div className="mt-3 space-y-2">
                    {recommendations.slice(0, 3).map((product) => (
                      <div key={product.id} className="flex items-center gap-3 rounded-2xl bg-zinc-50 p-2">
                        <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
                          <StoreImage src={product.imageUrls[0]} alt="" sizes="56px" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{product.name}</p>
                          <p className="text-xs font-bold">{formatStorePrice(product.price)}</p>
                        </div>
                        <button
                          type="button"
                          className="h-10 rounded-xl border bg-white px-3 text-xs font-bold active:scale-95"
                          style={{ borderColor: accent, color: accent }}
                          onClick={() => onAdd(product)}
                        >
                          + Add
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="mt-6 space-y-2 rounded-2xl bg-zinc-50 p-4 text-sm">
                <div className="flex justify-between text-zinc-600">
                  <span>Subtotal</span>
                  <span>{formatStorePrice(subtotal)}</span>
                </div>
                {savings > 0 ? (
                  <div className="flex justify-between font-medium text-emerald-700">
                    <span>You save</span>
                    <span>− {formatStorePrice(savings)}</span>
                  </div>
                ) : null}
                {estimatedAdvance > 0 ? (
                  <>
                    <div className="flex justify-between text-zinc-600">
                      <span>COD advance</span>
                      <span>{formatStorePrice(estimatedAdvance)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-600">
                      <span>Pay on delivery</span>
                      <span>{formatStorePrice(Math.max(0, subtotal - estimatedAdvance))}</span>
                    </div>
                  </>
                ) : null}
                <div className="flex justify-between border-t border-zinc-200 pt-2 text-base font-bold">
                  <span>Total</span>
                  <span>{formatStorePrice(subtotal)}</span>
                </div>
              </section>

              {checkout ? <div className="mt-5">{checkoutForm}</div> : null}
            </>
          )}
        </div>

        {!checkout && cart.length ? (
          <footer className="shrink-0 border-t border-zinc-100 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <button
              type="button"
              className="h-12 w-full rounded-2xl text-sm font-bold text-white shadow-sm transition active:scale-[0.99]"
              style={{ backgroundColor: accent }}
              onClick={onCheckout}
            >
              Proceed to checkout · {formatStorePrice(subtotal)}
            </button>
            <button type="button" className="mt-2 h-11 w-full text-sm font-semibold text-zinc-600" onClick={onClose}>
              Continue shopping
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
