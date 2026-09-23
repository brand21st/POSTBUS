import type { SupabaseClient } from "@supabase/supabase-js";
import { pickStoreWebsite } from "@/modules/invoices/schema";
import { normalizeShopDomain } from "@/modules/shopify/oauth";
import {
  loadShopifyConnection,
  resolveShopifyAdminToken,
  SHOPIFY_API_VERSION,
  SHOPIFY_GRAPHQL_API_VERSION,
} from "@/modules/shopify/orders";

const SHOP_DOMAINS_QUERY = `
  query InvoiceShopDomains {
    shop {
      primaryDomain { host }
      myshopifyDomain
      domains { host }
    }
  }
`;

export async function fetchShopifyPrimaryDomain(
  supabase: SupabaseClient,
  organizationId: string
): Promise<string | null> {
  try {
    const connection = await loadShopifyConnection(supabase, organizationId);
    const token = await resolveShopifyAdminToken(connection);
    const shop = connection?.shop_domain;
    if (!token || !shop) return null;
    const host = normalizeShopDomain(shop);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const [graphql, rest] = await Promise.all([
      fetch(`https://${host}/admin/api/${SHOPIFY_GRAPHQL_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: SHOP_DOMAINS_QUERY }),
        signal: controller.signal,
      }).catch(() => null),
      fetch(`https://${host}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, {
        headers: {
          "X-Shopify-Access-Token": token,
          Accept: "application/json",
        },
        signal: controller.signal,
      }).catch(() => null),
    ]);
    clearTimeout(timer);

    const graphqlJson = graphql?.ok
      ? ((await graphql.json()) as {
          data?: {
            shop?: {
              primaryDomain?: { host?: string | null } | null;
              myshopifyDomain?: string | null;
              domains?: Array<{ host?: string | null }>;
            };
          };
        })
      : null;
    const restJson = rest?.ok
      ? ((await rest.json()) as { shop?: { domain?: string | null; myshopify_domain?: string | null } })
      : null;
    const shopNode = graphqlJson?.data?.shop;
    const hosts = [
      shopNode?.primaryDomain?.host,
      ...(shopNode?.domains ?? []).map((domain) => domain.host),
      restJson?.shop?.domain,
      shopNode?.myshopifyDomain,
      restJson?.shop?.myshopify_domain,
    ];
    const wwwHost = hosts
      .map((value) => String(value || "").trim().toLowerCase())
      .find((value) => value.startsWith("www.") && !/\.myshopify\.com$/i.test(value));
    return wwwHost || pickStoreWebsite(hosts) || null;
  } catch {
    return null;
  }
}
