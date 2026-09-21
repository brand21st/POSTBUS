function optional(value: string | undefined) {
  return value?.trim() || "";
}

export const env = {
  // NEXT_PUBLIC_* must be read as static literals so Next can inline them
  // into the browser bundle. Dynamic process.env[name] stays empty on the client.
  appUrl: optional(process.env.NEXT_PUBLIC_APP_URL) || "http://localhost:3000",
  supabaseUrl: optional(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: optional(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  supabaseServiceRoleKey: optional(process.env.SUPABASE_SERVICE_ROLE_KEY),
  encryptionKey: optional(process.env.INTEGRATION_ENCRYPTION_KEY),
  redisUrl: optional(process.env.REDIS_URL) || "redis://127.0.0.1:6379",
  shopifyApiKey: optional(process.env.SHOPIFY_API_KEY),
  shopifyApiSecret: optional(process.env.SHOPIFY_API_SECRET),
  shopifyScopes:
    optional(process.env.SHOPIFY_SCOPES) ||
    "read_orders,write_orders,read_fulfillments,write_fulfillments,read_locations",
  shopifyAppUrl: optional(process.env.SHOPIFY_APP_URL),
  // CEPT UAT is a public sandbox URL; default so production still works if Coolify env was left blank.
  indiaPostUatBaseUrl:
    optional(process.env.INDIA_POST_UAT_BASE_URL) ||
    "https://test.cept.gov.in/beextcustomer/v1",
  indiaPostProdBaseUrl: optional(process.env.INDIA_POST_PROD_BASE_URL),
  stripeSecretKey: optional(process.env.STRIPE_SECRET_KEY),
  stripeWebhookSecret: optional(process.env.STRIPE_WEBHOOK_SECRET),
};

export function isShopifyAppConfigured() {
  return Boolean(env.shopifyApiKey && env.shopifyApiSecret);
}

export function isBillingConfigured() {
  return Boolean(env.stripeSecretKey);
}

export function indiaPostBaseUrl(environment: "UAT" | "PRODUCTION") {
  return environment === "PRODUCTION"
    ? env.indiaPostProdBaseUrl
    : env.indiaPostUatBaseUrl;
}
