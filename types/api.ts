import type {
  BillingPlanCode,
  FulfillmentStatus,
  IntegrationStatus,
  MemberRole,
  OrderSource,
  OrderStatus,
  PaymentStatus,
  ProviderEnvironment,
  ShipmentStatus,
} from "@/types/domain";

export type MeUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  whatsappNumber?: string | null;
};

export type MeOrganization = {
  id: string;
  name: string;
  slug: string | null;
  timezone?: string;
  currency?: string;
};

export type MeMembership = {
  id: string;
  name: string;
  slug?: string | null;
  role?: MemberRole;
};

export type MeSubscription = {
  planCode?: BillingPlanCode | string | null;
  planName?: string | null;
  status?: string | null;
  features?: string[];
};

export type MeResponse = {
  user: MeUser;
  organization: MeOrganization | null;
  role?: MemberRole | null;
  organizations?: MeMembership[];
  memberships?: MeMembership[];
  subscription?: MeSubscription | null;
};

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type KpiMetric = {
  key?: string;
  label?: string;
  value?: number | string | null;
  previous?: number | string | null;
  change?: number | string | null;
  comparisonAvailable?: boolean;
};

export type DashboardKpis = {
  orders?: KpiMetric | number;
  ready?: KpiMetric | number;
  readyToShip?: KpiMetric | number;
  booked?: KpiMetric | number;
  inTransit?: KpiMetric | number;
  delivered?: KpiMetric | number;
  failed?: KpiMetric | number;
  metrics?: KpiMetric[];
};

export type PipelineStage = {
  status?: string;
  key?: string;
  label?: string;
  count?: number;
};

export type DashboardPipeline = {
  stages?: PipelineStage[];
  items?: PipelineStage[];
};

export type AnalyticsRange = "today" | "month" | "year";

export type AnalyticsPeriodKpi = {
  shipments: number;
  revenue: number;
  orders: number;
  codOrders: number;
  codAmount: number;
};

export type AnalyticsSeriesPoint = {
  key: string;
  label: string;
  revenue: number;
  shipments: number;
  orders: number;
  cod: number;
  prepaid: number;
};

export type AnalyticsSourceShare = {
  source: string;
  label: string;
  orders: number;
  revenue: number;
  share: number;
};

export type DashboardAnalytics = {
  timezone: string;
  generatedAt: string;
  truncated: boolean;
  today: AnalyticsPeriodKpi;
  month: AnalyticsPeriodKpi;
  year: AnalyticsPeriodKpi;
  topSource: AnalyticsSourceShare | null;
  sources: Record<AnalyticsRange, AnalyticsSourceShare[]>;
  series: Record<AnalyticsRange, AnalyticsSeriesPoint[]>;
};

export type CustomerSummary = {
  id?: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type AddressSummary = {
  id?: string;
  name?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
};

export type LineItem = {
  id?: string;
  title: string;
  sku?: string | null;
  quantity: number;
  unitPrice?: number | string;
  unit_price?: number | string;
  weightGrams?: number | null;
  weight_grams?: number | null;
};

export type OrderRecord = {
  id: string;
  orderNumber?: string;
  order_number?: string;
  source?: OrderSource | string;
  status?: OrderStatus | string;
  paymentStatus?: PaymentStatus | string;
  payment_status?: PaymentStatus | string;
  fulfillmentStatus?: FulfillmentStatus | string;
  fulfillment_status?: FulfillmentStatus | string;
  totalAmount?: number | string;
  total_amount?: number | string;
  currency?: string;
  customer?: CustomerSummary | null;
  customerName?: string | null;
  shippingAddress?: AddressSummary | null;
  billingAddress?: AddressSummary | null;
  lineItems?: LineItem[];
  line_items?: LineItem[];
  items?: number;
  shipment?: ShipmentRecord | null;
  invoice?: InvoiceSummary | null;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
};

export type BulkOrderStatusResult = {
  action: "fulfill";
  selected: number;
  updated: Array<{ id: string; orderNumber: string }>;
  skipped: Array<{ id: string; orderNumber?: string; reason: string }>;
  failed: Array<{ id: string; reason: string }>;
};

export type ShipmentRecord = {
  id: string;
  orderId?: string;
  order_id?: string;
  orderNumber?: string;
  order_number?: string;
  status?: ShipmentStatus | string;
  barcode?: string | null;
  trackingNumber?: string | null;
  tracking_number?: string | null;
  serviceCode?: string | null;
  service_code?: string | null;
  paymentMode?: string | null;
  payment_mode?: string | null;
  weightGrams?: number | null;
  weight_grams?: number | null;
  tariffAmount?: number | string | null;
  tariff_amount?: number | string | null;
  lastError?: string | null;
  last_error?: string | null;
  customer?: CustomerSummary | null;
  createdAt?: string;
  created_at?: string;
  bookedAt?: string | null;
  booked_at?: string | null;
  invoice?: InvoiceSummary | null;
};

export type InvoiceSummary = {
  id: string;
  status?: string;
  invoiceNumber?: string;
  invoice_number?: string;
  errorMessage?: string | null;
  error_message?: string | null;
};

export type InvoiceRecord = InvoiceSummary & {
  organizationId?: string;
  orderId?: string;
  order_id?: string;
  shipmentId?: string;
  shipment_id?: string;
  trackingNumber?: string | null;
  tracking_number?: string | null;
  invoiceDate?: string;
  invoice_date?: string;
  currency?: string;
  totalAmount?: number | string;
  total_amount?: number | string;
  orderNumber?: string | null;
  order_number?: string | null;
  customerName?: string | null;
  customer_name?: string | null;
  createdAt?: string;
  created_at?: string;
};

export type InvoiceAppearance = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  textColor: string;
  tableHeaderColor: string;
  borderColor: string;
  totalHighlightColor: string;
};

export type InvoicePreviewData = {
  storeName: string;
  storePhone: string;
  storeEmail: string;
  storeGstin: string;
  storeWebsite: string;
  storeAddress: string[];
  hasLogo: boolean;
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  orderDate: string;
  shipmentId: string;
  trackingNumber: string;
  paymentMethod: string;
  paymentStatus: string;
  currency: string;
  customer: { name: string; phone: string; email: string; lines: string[] };
  billing: { name: string; phone: string; email: string; lines: string[] };
  shipping: { name: string; phone: string; email: string; lines: string[] };
  items: Array<{ title: string; sku: string | null; quantity: number; unitPrice: number; lineTotal: number }>;
  subtotal: number;
  discount: number;
  shippingAmount: number;
  taxAmount: number;
  total: number;
  codAmount: number | null;
};

export type LabelRecord = {
  id: string;
  shipmentId?: string;
  shipment_id?: string;
  kind?: string | null;
  status?: string;
  fileUrl?: string | null;
  file_url?: string | null;
  mimeType?: string | null;
  mime_type?: string | null;
  createdAt?: string;
  created_at?: string;
  barcode?: string | null;
  trackingNumber?: string | null;
  tracking_number?: string | null;
  orderNumber?: string | null;
  order_number?: string | null;
  printStatus?: string | null;
  print_status?: string | null;
  printError?: string | null;
  print_error?: string | null;
  printJob?: PrintJobRecord | null;
  packingLabelId?: string | null;
  packing_label_id?: string | null;
  indiaPostLabelId?: string | null;
  india_post_label_id?: string | null;
  packingStatus?: string | null;
  packing_status?: string | null;
  barcodeStatus?: string | null;
  barcode_status?: string | null;
};

export type ManifestRecord = {
  id: string;
  name?: string;
  status?: string;
  shipmentCount?: number;
  shipment_count?: number;
  fileUrl?: string | null;
  file_url?: string | null;
  createdAt?: string;
  created_at?: string;
};

export type TrackingEvent = {
  id?: string;
  shipmentId?: string;
  shipment_id?: string;
  eventCode?: string;
  event_code?: string;
  eventDescription?: string;
  event_description?: string;
  officeName?: string;
  office_name?: string;
  occurredAt?: string;
  occurred_at?: string;
};

export type TrackingRecord = {
  id: string;
  shipmentId?: string;
  shipment_id?: string;
  trackingNumber?: string | null;
  tracking_number?: string | null;
  barcode?: string | null;
  status?: string;
  orderNumber?: string | null;
  order_number?: string | null;
  events?: TrackingEvent[];
  latestEvent?: TrackingEvent | null;
};

export type AutomationSettings = {
  organizationId?: string;
  autoShopifySync?: boolean;
  auto_shopify_sync?: boolean;
  autoShipmentCreation?: boolean;
  auto_shipment_creation?: boolean;
  autoBooking?: boolean;
  auto_booking?: boolean;
  autoLabelGeneration?: boolean;
  auto_label_generation?: boolean;
  autoManifest?: boolean;
  auto_manifest?: boolean;
  autoTrackingSync?: boolean;
  auto_tracking_sync?: boolean;
  autoShopifyFulfillment?: boolean;
  auto_shopify_fulfillment?: boolean;
  autoWatiOrderConfirmation?: boolean;
  auto_wati_order_confirmation?: boolean;
  autoWatiProcessing?: boolean;
  auto_wati_processing?: boolean;
  autoWatiBooked?: boolean;
  auto_wati_booked?: boolean;
  autoWatiInTransit?: boolean;
  auto_wati_in_transit?: boolean;
  autoWatiDelivered?: boolean;
  auto_wati_delivered?: boolean;
  autoLabelPrinting?: boolean;
  auto_label_printing?: boolean;
};

export type PrintStation = {
  selectedPrinterName?: string | null;
  selected_printer_name?: string | null;
  paperSize?: string;
  paper_size?: string;
  orientation?: string;
  copies?: number;
  autoPrintMerchant?: boolean;
  auto_print_merchant?: boolean;
  connected?: boolean;
  printerNames?: string[];
  printer_names?: string[];
  agentName?: string | null;
  agent_name?: string | null;
  tokenPrefix?: string | null;
  token_prefix?: string | null;
  lastSeenAt?: string | null;
  last_seen_at?: string | null;
  offlineMessage?: string | null;
  offline_message?: string | null;
};

export type PrintJobRecord = {
  id: string;
  status?: string | null;
  source?: string | null;
  printerName?: string | null;
  printer_name?: string | null;
  errorMessage?: string | null;
  error_message?: string | null;
  printedAt?: string | null;
  printed_at?: string | null;
};

export type IntegrationCard = {
  provider: string;
  name?: string;
  status?: IntegrationStatus | string;
  lastSyncAt?: string | null;
  last_sync_at?: string | null;
  lastError?: string | null;
  last_error?: string | null;
  comingLater?: boolean;
  coming_later?: boolean;
  appConfigured?: boolean;
  readyToSync?: boolean;
  shopDomain?: string | null;
};

export type IntegrationsResponse = {
  items?: IntegrationCard[];
  integrations?: IntegrationCard[];
  shopify?: IntegrationCard;
  indiaPost?: IntegrationCard;
  india_post?: IntegrationCard;
  wati?: IntegrationCard;
};

export type WatiConfig = {
  status?: IntegrationStatus | string;
  apiBaseUrl?: string | null;
  api_base_url?: string | null;
  clientId?: string | null;
  client_id?: string | null;
  tokenMasked?: string | null;
  token_masked?: string | null;
  hasToken?: boolean;
  has_token?: boolean;
  channelId?: string | null;
  channel_id?: string | null;
  channelName?: string | null;
  channel_name?: string | null;
  channelPhone?: string | null;
  channel_phone?: string | null;
  orderConfirmationTemplateName?: string | null;
  order_confirmation_template_name?: string | null;
  processingTemplateName?: string | null;
  processing_template_name?: string | null;
  bookedTemplateName?: string | null;
  booked_template_name?: string | null;
  inTransitTemplateName?: string | null;
  in_transit_template_name?: string | null;
  deliveredTemplateName?: string | null;
  delivered_template_name?: string | null;
  lastVerifiedAt?: string | null;
  last_verified_at?: string | null;
  lastError?: string | null;
  last_error?: string | null;
  webhookId?: string | null;
  webhook_id?: string | null;
  webhookUrl?: string | null;
  webhook_url?: string | null;
  lastWebhookAt?: string | null;
  last_webhook_at?: string | null;
  lastWebhookEvent?: string | null;
  last_webhook_event?: string | null;
  lastWebhookError?: string | null;
  last_webhook_error?: string | null;
  canRegisterWebhook?: boolean;
  can_register_webhook?: boolean;
  channels?: Array<{
    id?: string | null;
    name?: string | null;
    channel?: string | null;
    platform_id?: string | null;
  }>;
  templates?: Array<{
    id?: string | null;
    name?: string;
    status?: string | null;
    category?: string | null;
    body?: string | null;
    customParams?: Array<{ name?: string | null }>;
  }>;
};

export type ShopifyConfig = {
  status?: IntegrationStatus | string;
  shopDomain?: string | null;
  shop_domain?: string | null;
  clientId?: string | null;
  client_id?: string | null;
  hasClientSecret?: boolean;
  has_client_secret?: boolean;
  apiKeyMasked?: string | null;
  api_key_masked?: string | null;
  hasApiKey?: boolean;
  has_api_key?: boolean;
  hasApiSecret?: boolean;
  has_api_secret?: boolean;
  requestedScopes?: string | null;
  requested_scopes?: string | null;
  webhookUrl?: string;
  webhook_url?: string;
  appConfigured?: boolean;
  readyToSync?: boolean;
  lastSyncAt?: string | null;
  last_sync_at?: string | null;
  lastError?: string | null;
  last_error?: string | null;
};

export type IndiaPostConfig = {
  environment?: ProviderEnvironment | string;
  status?: IntegrationStatus | string;
  bulkCustomerId?: string | null;
  bulk_customer_id?: string | null;
  contractId?: string | null;
  contract_id?: string | null;
  pickupDropoffOfficeId?: string | null;
  pickup_dropoff_office_id?: string | null;
  usernameMasked?: string | null;
  username_masked?: string | null;
  hasPassword?: boolean;
  has_password?: boolean;
  lastVerifiedAt?: string | null;
  last_verified_at?: string | null;
  lastError?: string | null;
  last_error?: string | null;
  uatConfigured?: boolean;
  prodConfigured?: boolean;
  bookingWebhookUrl?: string;
  booking_webhook_url?: string;
  eventsWebhookUrl?: string;
  events_webhook_url?: string;
  contracts?: IndiaPostContract[];
  defaultServiceCode?: string;
  barcodeRange?: IndiaPostBarcodeRange | null;
  barcodeRanges?: IndiaPostBarcodeRange[];
};

export type IndiaPostContract = {
  id?: string;
  serviceCode: string;
  contractId: string;
  isDefault?: boolean;
  isActive?: boolean;
  label?: string;
};

export type IndiaPostBarcodeRange = {
  prefix?: string;
  suffix?: string;
  startNumber?: number;
  endNumber?: number;
  nextNumber?: number;
  serviceCode?: string | null;
};

export type BillingResponse = {
  configurationRequired?: boolean;
  configuration_required?: boolean;
  plan?: {
    code?: string;
    name?: string;
    shipmentLimit?: number | null;
  } | null;
  subscription?: {
    status?: string;
    billingCycleStart?: string | null;
    billingCycleEnd?: string | null;
  } | null;
  usage?: {
    metric?: string;
    quantity?: number;
    limit?: number | null;
  } | null;
  invoices?: Array<{
    id: string;
    number?: string;
    amount?: number | string;
    currency?: string;
    status?: string;
    issuedAt?: string;
    issued_at?: string;
  }>;
};

export type SearchResult = {
  id: string;
  type?: string;
  title?: string;
  subtitle?: string;
  href?: string;
};

export type SearchResponse = {
  items?: SearchResult[];
  results?: SearchResult[];
  orders?: SearchResult[];
  shipments?: SearchResult[];
  customers?: SearchResult[];
};

export type NotificationRecord = {
  id: string;
  title: string;
  body?: string | null;
  type?: string;
  entityId?: string | null;
  entity_id?: string | null;
  entityType?: string | null;
  entity_type?: string | null;
  readAt?: string | null;
  read_at?: string | null;
  createdAt?: string;
  created_at?: string;
  href?: string | null;
};

export type MemberRecord = {
  id: string;
  email?: string | null;
  fullName?: string | null;
  full_name?: string | null;
  role?: MemberRole | string;
  createdAt?: string;
  created_at?: string;
};

export type InviteRecord = {
  id: string;
  email: string;
  role?: MemberRole | string;
  expiresAt?: string;
  expires_at?: string;
};

export type ApiKeyRecord = {
  id: string;
  name: string;
  keyPrefix?: string;
  key_prefix?: string;
  status?: string;
  lastUsedAt?: string | null;
  last_used_at?: string | null;
  createdAt?: string;
  created_at?: string;
  secret?: string;
};

export type WebhookRecord = {
  id: string;
  url: string;
  events?: string[];
  isActive?: boolean;
  is_active?: boolean;
  createdAt?: string;
  created_at?: string;
};

export type AuditLogRecord = {
  id: string;
  action: string;
  entityType?: string;
  entity_type?: string;
  entityId?: string;
  entity_id?: string;
  actorId?: string | null;
  actor_id?: string | null;
  createdAt?: string;
  created_at?: string;
};

export type OrganizationSettings = {
  id?: string;
  name?: string;
  slug?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  logoPath?: string | null;
  logo_path?: string | null;
  logoUrl?: string | null;
  logo_url?: string | null;
};

export type TrackingPageStatus = "DRAFT" | "PUBLISHED" | "DISABLED";

export type TrackingPageSocial = {
  instagram?: string | null;
  facebook?: string | null;
  website?: string | null;
};

export type TrackingPageBanner = {
  id: string;
  imagePath?: string | null;
  imageUrl?: string | null;
  href?: string | null;
  alt?: string | null;
  sortOrder?: number;
  enabled?: boolean;
};

export type TrackingPageRecord = {
  id: string;
  organizationId: string;
  subdomain: string;
  status: TrackingPageStatus;
  storeName: string;
  tagline?: string | null;
  about?: string | null;
  logoPath?: string | null;
  logoUrl?: string | null;
  primaryColor: string;
  backgroundColor: string;
  locationName?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  mapUrl?: string | null;
  social: TrackingPageSocial;
  banners: TrackingPageBanner[];
  publishedAt?: string | null;
  publicUrl: string;
  createdAt?: string;
  updatedAt?: string;
};

export type SubdomainAvailability = {
  available: boolean;
  reason: "available" | "taken" | "reserved" | "invalid";
};

export type PublicTrackingEvent = {
  id?: string;
  eventCode?: string | null;
  eventDescription?: string | null;
  officeName?: string | null;
  occurredAt?: string | null;
};

export type PublicTrackResult = {
  found: boolean;
  liveTracking: "ok" | "unavailable" | "not_connected";
  liveMessage?: string | null;
  shipment?: {
    id: string;
    barcode?: string | null;
    trackingNumber?: string | null;
    status?: string | null;
    orderNumber?: string | null;
    destinationCity?: string | null;
    destinationState?: string | null;
    events: PublicTrackingEvent[];
  } | null;
};
