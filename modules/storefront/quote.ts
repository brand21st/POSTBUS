import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveStoreCart } from "./resolve-cart";
import type { BundleSelection } from "./bundle-pricing";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { roundMoney } from "@/modules/orders/payment";
import { catalogCodAdvancePaid } from "@/modules/products/payment";

export type StoreQuoteItem = { productId: string; quantity: number };
export type StorePaymentPreference = "PREPAID" | "COD";


export function quoteCatalogPayment(input: {
  preference: StorePaymentPreference;
  lines: Array<{
    unitPrice: number;
    quantity: number;
    prepaidEnabled: boolean;
    codEnabled: boolean;
    codAdvancePercent: number | string | null;
  }>;
}) {
  const total = roundMoney(input.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
  if (input.preference === "PREPAID") {
    const blocked = input.lines.find((line) => !line.prepaidEnabled);
    if (blocked) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "A product in your cart does not support prepaid.");
    }
    return {
      preference: "PREPAID" as const,
      total,
      amountDueNow: total,
      amountOnDelivery: 0,
      expectedAdvance: 0,
    };
  }
  const blocked = input.lines.find((line) => !line.codEnabled);
  if (blocked) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "A product in your cart does not support COD.");
  }
  const expectedAdvance = catalogCodAdvancePaid(
    input.lines.map((line) => ({
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      product: line,
    }))
  );
  const capped = Math.min(total, Math.max(0, expectedAdvance));
  return {
    preference: "COD" as const,
    total,
    amountDueNow: capped,
    amountOnDelivery: roundMoney(total - capped),
    expectedAdvance: capped,
  };
}

export async function quotePublicStorePayment(
  supabase: SupabaseClient,
  organizationId: string,
  items: StoreQuoteItem[],
  preference: StorePaymentPreference,
  bundles: BundleSelection[] = []
) {
  const resolved = await resolveStoreCart(supabase, organizationId, items, bundles);
  const payment = quoteCatalogPayment({ preference, lines: resolved.lines.map((line) => ({ ...line, prepaidEnabled: line.prepaidEnabled !== false, codEnabled: line.codEnabled !== false })) });
  return { ...payment, quoteVersion: resolved.quoteVersion, bundles: resolved.bundles, items: resolved.lines.map((line) => ({ productId: line.productId, name: line.title, quantity: line.quantity, unitPrice: line.unitPrice })) };
}
