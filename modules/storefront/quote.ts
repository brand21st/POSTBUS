import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { roundMoney } from "@/modules/orders/payment";
import { catalogCodAdvancePaid } from "@/modules/products/payment";
import { loadCatalogProducts } from "@/modules/products/service";

export type StoreQuoteItem = { productId: string; quantity: number };
export type StorePaymentPreference = "PREPAID" | "COD";

function catalogOnHand(product: { inventory_balances?: unknown }) {
  const value = product.inventory_balances;
  if (!value) return 0;
  if (Array.isArray(value)) return Number(value[0]?.on_hand ?? 0);
  if (typeof value === "object" && value && "on_hand" in value) {
    return Number((value as { on_hand?: number }).on_hand ?? 0);
  }
  return 0;
}

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
  preference: StorePaymentPreference
) {
  if (!items.length) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Add at least one product.");
  }
  const catalog = await loadCatalogProducts(
    supabase,
    organizationId,
    items.map((item) => item.productId)
  );
  const byId = new Map(catalog.map((row) => [String(row.id), row]));
  const lines = items.map((item) => {
    const product = byId.get(item.productId) as
      | {
          id: string;
          name: string;
          price: number | string;
          active: boolean;
          store_visible?: boolean;
          prepaid_enabled?: boolean;
          cod_enabled?: boolean;
          cod_advance_percent?: number | string | null;
          inventory_balances?: unknown;
        }
      | undefined;
    if (!product || !product.active || product.store_visible === false) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "A product in your cart is no longer available.");
    }
    if (catalogOnHand(product) < item.quantity) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${product.name} is out of stock.`);
    }
    return {
      unitPrice: Number(product.price ?? 0),
      quantity: item.quantity,
      prepaidEnabled: product.prepaid_enabled !== false,
      codEnabled: product.cod_enabled !== false,
      codAdvancePercent: product.cod_advance_percent ?? 0,
    };
  });
  return quoteCatalogPayment({ preference, lines });
}
