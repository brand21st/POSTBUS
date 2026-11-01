import { shopifyAdminGraphql } from "@/modules/shopify/graphql/client";
import { rupeesToPaise } from "@/modules/ai-accountant/money";
import type { ShopifyTaxSnapshot } from "@/modules/shopify/tax-snapshot";

const ORDER_TAX_QUERY = `
  query OrderTax($id: ID!) {
    order(id: $id) {
      taxesIncluded
      taxLines { title rate priceSet { shopMoney { amount } } }
      lineItems(first: 50) {
        pageInfo { hasNextPage }
        nodes {
          sku title variantTitle quantity
          originalUnitPriceSet { shopMoney { amount } }
          taxLines { title rate priceSet { shopMoney { amount } } }
          discountAllocations { allocatedAmountSet { shopMoney { amount } } }
        }
      }
    }
  }
`;

type Money = { shopMoney?: { amount?: string | null } | null } | null;
type TaxNode = { title?: string | null; rate?: number | null; priceSet?: Money };

function amount(money: Money) {
  return rupeesToPaise(money?.shopMoney?.amount ?? 0) ?? 0;
}

export async function fetchShopifyOrderTax(shop: string, token: string, legacyOrderId: string): Promise<ShopifyTaxSnapshot | null> {
  const id = legacyOrderId.startsWith("gid://") ? legacyOrderId : `gid://shopify/Order/${legacyOrderId}`;
  const { data } = await shopifyAdminGraphql<{
    order?: {
      taxesIncluded?: boolean | null;
      taxLines?: TaxNode[] | null;
      lineItems?: {
        pageInfo?: { hasNextPage?: boolean };
        nodes?: Array<{
          sku?: string | null;
          title?: string | null;
          variantTitle?: string | null;
          quantity?: number | null;
          originalUnitPriceSet?: Money;
          taxLines?: TaxNode[] | null;
          discountAllocations?: Array<{ allocatedAmountSet?: Money }> | null;
        }>;
      };
    } | null;
  }>(shop, token, ORDER_TAX_QUERY, { id });
  const order = data.order;
  if (!order) return null;
  const mapTax = (line: TaxNode) => ({
    title: String(line.title ?? "Tax"),
    rateBps: line.rate == null ? null : Math.round(Number(line.rate) * 10000),
    amountPaise: amount(line.priceSet ?? null),
  });
  return {
    taxesIncluded: typeof order.taxesIncluded === "boolean" ? order.taxesIncluded : null,
    taxLines: (order.taxLines ?? []).map(mapTax),
    lineTaxes: (order.lineItems?.nodes ?? []).map((line) => ({
      sku: line.sku ? String(line.sku) : null,
      title: String(line.title || "Item"),
      variant: line.variantTitle ? String(line.variantTitle) : null,
      quantity: Number(line.quantity ?? 1),
      unitPricePaise: amount(line.originalUnitPriceSet ?? null),
      discountPaise: (line.discountAllocations ?? []).reduce((sum, row) => sum + amount(row.allocatedAmountSet ?? null), 0),
      taxLines: (line.taxLines ?? []).map(mapTax),
    })),
    capturedAt: new Date().toISOString(),
  };
}
