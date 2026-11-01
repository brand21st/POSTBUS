/** Client-side shapes of the PostBus v1 responses the embedded app reads (only the fields it uses). */

export type ShipmentSummary = {
  id: string;
  status: string;
  barcode?: string | null;
  tracking_number?: string | null;
  service_code?: string | null;
  weight_grams?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  last_error_code?: string | null;
  last_error?: string | null;
  booked_at?: string | null;
};

export type OrderLineItem = {
  id: string;
  title: string;
  sku?: string | null;
  quantity: number;
  unit_price?: number | string | null;
  weight_grams?: number | null;
  imageUrl?: string | null;
};

export type OrderAddress = {
  name?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
};

export type OrderListItem = {
  id: string;
  orderNumber: string;
  source: string;
  status: string;
  paymentStatus: string;
  totalAmount: number | string | null;
  currency?: string | null;
  createdAt: string;
  customerName: string | null;
  shipping_address?: { pincode?: string | null } | null;
  items: number;
  shipment: ShipmentSummary | null;
  parcelWeightGrams?: number | null;
  indiaPostService?: string | null;
};

export type OrderDetail = OrderListItem & {
  customer: { name?: string | null; phone?: string | null; email?: string | null } | null;
  shipping_address?: OrderAddress | null;
  lineItems: OrderLineItem[];
  codAmount?: number | string | null;
};

export type OrderList = { items: OrderListItem[]; page: number; pageSize: number; total: number };

export type ContractSummary = { serviceCode: string; contractId: string; isDefault?: boolean; isActive?: boolean };

export type IndiaPostSettings = {
  status: string;
  environment: string;
  bulkCustomerId?: string | null;
  usernameMasked?: string;
  hasPassword?: boolean;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
  contracts: ContractSummary[];
  defaultServiceCode: string;
  defaultLengthCm: number | null;
  defaultWidthCm: number | null;
  defaultHeightCm: number | null;
  defaultWeightGrams: number | null;
  pickupOfficeId?: string | null;
  pickupOfficeName?: string | null;
  pickupOfficePincode?: string | null;
};

export type KpiMetric = { key: string; label: string; value: number };
export type Kpis = Record<"readyToShip" | "booked" | "inTransit" | "delivered" | "failed", KpiMetric>;

export type BookingIssue = { orderId?: string; orderNumber?: string; field: string; error: string };
export type BulkBookingResult = {
  total: number;
  valid: number;
  invalid: number;
  queued: number;
  processing: number;
  booked: number;
  failed: number;
  retrying: number;
  rows: Array<{ orderId?: string; orderNumber?: string; valid: boolean; issues: BookingIssue[]; status: string }>;
  issues: BookingIssue[];
};

export type TariffQuote = {
  service: string;
  chargeableWeightGrams: number | null;
  baseTariff: number;
  codCharges: number | null;
  totalTax: number;
  estimatedTotal: number;
  currency: string;
};

export type AutomationSettings = {
  autoShopifySync?: boolean;
  autoShipmentCreation?: boolean;
  autoBooking?: boolean;
  autoShopifyFulfillment?: boolean;
  autoTrackingSync?: boolean;
};

export type IndiaPostOffice = { officeId?: string; id?: string; officeName?: string; name?: string; pincode?: string };
