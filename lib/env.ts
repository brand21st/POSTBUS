import { indiaPostResolvedBaseUrl } from "@/modules/india-post/environment";

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
  // "database" drains background_jobs from a scheduled request and needs no Redis.
  // "redis" hands jobs to BullMQ and requires `npm run workers` to be running.
  jobRunner: (optional(process.env.JOB_RUNNER).toLowerCase() === "redis"
    ? "redis"
    : "database") as "redis" | "database",
  cronSecret: optional(process.env.CRON_SECRET),
  shopifyApiKey: optional(process.env.SHOPIFY_API_KEY),
  shopifyApiSecret: optional(process.env.SHOPIFY_API_SECRET),
  shopifyScopes:
    optional(process.env.SHOPIFY_SCOPES) ||
    "read_orders,write_orders,read_products,read_fulfillments,write_fulfillments,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_locations",
  shopifyAppUrl: optional(process.env.SHOPIFY_APP_URL),
  // CEPT UAT is a public sandbox URL; default so production still works if Coolify env was left blank.
  indiaPostUatBaseUrl:
    optional(process.env.INDIA_POST_UAT_BASE_URL) ||
    "https://test.cept.gov.in/beextcustomer",
  indiaPostProdBaseUrl:
    optional(process.env.INDIA_POST_PROD_BASE_URL) ||
    "https://app.indiapost.gov.in/beextcustomer",
  indiaPostBookingBatchSize: optional(process.env.INDIA_POST_BOOKING_BATCH_SIZE) || "1",
  indiaPostBookingConcurrency: optional(process.env.INDIA_POST_BOOKING_CONCURRENCY) || "4",
  // Empty = webhook HTTP is acknowledged but events are quarantined (not processed). Set official CEPT CIDRs only after India Post confirms them.
  indiaPostWebhookAllowedCidrs: optional(process.env.INDIA_POST_WEBHOOK_ALLOWED_CIDRS),
  indiaPostTrackingSyncMinIntervalMs: optional(process.env.INDIA_POST_TRACKING_SYNC_MIN_INTERVAL_MS) || "900000",
  indiaPostTrackingSyncPageSize: optional(process.env.INDIA_POST_TRACKING_SYNC_PAGE_SIZE) || "500",
  indiaPostTrackingSyncEnqueueLimit: optional(process.env.INDIA_POST_TRACKING_SYNC_ENQUEUE_LIMIT) || "50",
  indiaPostTrackingIsolateMaxRequests: optional(process.env.INDIA_POST_TRACKING_ISOLATE_MAX_REQUESTS) || "32",
  indiaPostTrackingAuthCooldownMs: optional(process.env.INDIA_POST_TRACKING_AUTH_COOLDOWN_MS) || "1800000",
  indiaPostTrackingLookupCooldownMs: optional(process.env.INDIA_POST_TRACKING_LOOKUP_COOLDOWN_MS) || "900000",
  indiaPostTrackingP0CanaryOrganizationId: optional(process.env.INDIA_POST_TRACKING_P0_CANARY_ORGANIZATION_ID),
  indiaPostTrackingP0CanaryAwbs: optional(process.env.INDIA_POST_TRACKING_P0_CANARY_AWBS),
  indiaPostTrackingP0CanarySideEffects: optional(process.env.INDIA_POST_TRACKING_P0_CANARY_SIDE_EFFECTS) || "off",
  razorpayKeyId: optional(process.env.RAZORPAY_KEY_ID),
  razorpayKeySecret: optional(process.env.RAZORPAY_KEY_SECRET),
  razorpayWebhookSecret: optional(process.env.RAZORPAY_WEBHOOK_SECRET),
  razorpayPublicKeyId: optional(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID),
  posthogProjectToken: optional(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN),
  posthogHost: optional(process.env.NEXT_PUBLIC_POSTHOG_HOST) || "https://us.i.posthog.com",
  platformAdminEmail: optional(process.env.PLATFORM_ADMIN_EMAIL),
  vachatApiKey: optional(process.env.VACHAT_API_KEY),
  vachatApiBaseUrl: optional(process.env.VACHAT_API_BASE_URL),
  vachatWebhookSecret: optional(process.env.VACHAT_WEBHOOK_SECRET),
  // Coolify persistent volume destination. Relative DB paths are resolved under this root.
  labelStoragePath: optional(process.env.LABEL_STORAGE_PATH) || "/data/labels",
  // Default on. Set POSTBUS_UNICODE_LABEL_RENDERING=false to use Helvetica-only Postbus PDFs.
  unicodeLabelRendering: optional(process.env.POSTBUS_UNICODE_LABEL_RENDERING).toLowerCase() !== "false",
  invoiceStoragePath: (() => {
    const configured = optional(process.env.INVOICE_STORAGE_PATH);
    // /data/invoices is not on the Coolify labels volume, so PDFs vanished after write.
    if (!configured || configured === "/data/invoices") return "/data/labels/invoices";
    return configured;
  })(),
  coolifyBaseUrl: optional(process.env.COOLIFY_BASE_URL),
  coolifyApplicationUuid: optional(process.env.COOLIFY_APPLICATION_UUID),
  coolifyApiToken: optional(process.env.COOLIFY_API_TOKEN),
};

export function usesDatabaseJobRunner() {
  return env.jobRunner === "database";
}

export function isShopifyAppConfigured() {
  return Boolean(env.shopifyApiKey && env.shopifyApiSecret);
}

export function isBillingConfigured() {
  return Boolean(env.razorpayKeyId && env.razorpayKeySecret);
}

export function indiaPostBaseUrl(environment: "UAT" | "PRODUCTION") {
  return indiaPostResolvedBaseUrl(environment, env.indiaPostUatBaseUrl, env.indiaPostProdBaseUrl);
}
