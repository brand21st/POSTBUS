import { roundMoney } from "@/modules/orders/payment";

export type CatalogPaymentProduct = {
  prepaidEnabled: boolean;
  codEnabled: boolean;
  codAdvancePercent: number | string | null;
};

export function catalogLineAdvance(unitPrice: number, quantity: number, percent: number | string | null | undefined) {
  const rate = Math.min(100, Math.max(0, Number(percent) || 0));
  const lineTotal = roundMoney(unitPrice * quantity);
  return roundMoney((lineTotal * rate) / 100);
}

export function catalogCodAdvancePaid(
  lines: Array<{ unitPrice: number; quantity: number; product?: CatalogPaymentProduct | null }>
) {
  return roundMoney(
    lines.reduce((sum, line) => {
      const product = line.product;
      if (!product) return sum;
      return sum + catalogLineAdvance(line.unitPrice, line.quantity, product.codAdvancePercent);
    }, 0)
  );
}
