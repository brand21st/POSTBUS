import type { ShopifyRemoteLineItem, ShopifyRemoteOrder } from "@/modules/shopify/orders";
import { rupeesToPaise } from "@/modules/ai-accountant/money";

export type ShopifyTaxLine = { title: string; rateBps: number | null; amountPaise: number };
export type ShopifyTaxSnapshot = {
  taxesIncluded: boolean | null;
  taxLines: ShopifyTaxLine[];
  lineTaxes: Array<{
    sku: string | null;
    title: string;
    variant: string | null;
    quantity: number;
    unitPricePaise: number;
    discountPaise: number;
    taxLines: ShopifyTaxLine[];
  }>;
  capturedAt: string;
};

type RemoteTaxLine = { title?: string | null; price?: string | number | null; rate?: number | null };

function taxLine(line: RemoteTaxLine): ShopifyTaxLine {
  const rate = line.rate == null ? null : Math.round(Number(line.rate) * 10000);
  return {
    title: String(line.title ?? "Tax"),
    rateBps: Number.isInteger(rate) ? rate : null,
    amountPaise: rupeesToPaise(line.price ?? 0) ?? 0,
  };
}

export function extractShopifyTaxSnapshot(order: ShopifyRemoteOrder & {
  taxes_included?: boolean | null;
  tax_lines?: RemoteTaxLine[] | null;
}): ShopifyTaxSnapshot | null {
  const lineItems = (order.line_items ?? []) as Array<ShopifyRemoteLineItem & {
    tax_lines?: RemoteTaxLine[] | null;
    discount_allocations?: Array<{ amount?: string | number | null }> | null;
  }>;
  const hasLineTax = lineItems.some((item) => (item.tax_lines?.length ?? 0) > 0);
  const hasHeaderTax = (order.tax_lines?.length ?? 0) > 0;
  if (typeof order.taxes_included !== "boolean" && !hasHeaderTax && !hasLineTax) return null;
  return {
    taxesIncluded: typeof order.taxes_included === "boolean" ? order.taxes_included : null,
    taxLines: (order.tax_lines ?? []).map(taxLine),
    lineTaxes: lineItems.map((item) => ({
      sku: item.sku ? String(item.sku) : null,
      title: String(item.title || item.name || "Item"),
      variant: item.variant_title ? String(item.variant_title) : null,
      quantity: Number(item.quantity ?? 1),
      unitPricePaise: rupeesToPaise(item.price ?? 0) ?? 0,
      discountPaise: (item.discount_allocations ?? []).reduce((sum, row) => sum + (rupeesToPaise(row.amount ?? 0) ?? 0), 0),
      taxLines: (item.tax_lines ?? []).map(taxLine),
    })),
    capturedAt: new Date().toISOString(),
  };
}

export function shopifySnapshotIsComplete(snapshot: ShopifyTaxSnapshot | null, headerTaxPaise: number) {
  if (!snapshot || snapshot.taxesIncluded === null) return false;
  const lineTax = snapshot.lineTaxes.reduce(
    (sum, line) => sum + line.taxLines.reduce((tax, row) => tax + row.amountPaise, 0),
    0
  );
  if (headerTaxPaise > 0 && lineTax === 0 && snapshot.taxLines.length === 0) return false;
  return true;
}
