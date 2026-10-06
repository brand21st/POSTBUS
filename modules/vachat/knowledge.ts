import type { SupabaseClient } from "@supabase/supabase-js";
import { siteConfig } from "@/lib/site-config";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { vachatSingleLine } from "@/modules/vachat/notice-fields";
import { getPlatformVachatConfig, isPlatformVachatActive } from "@/modules/vachat/platform-config";
import { vachatHeaders } from "@/modules/vachat/service";
import { customerTrackingLink } from "@/modules/tracking-pages/host";
import { getTrackingPage } from "@/modules/tracking-pages/service";
import { logError, logInfo } from "@/lib/logger";
import { formatPolicyKnowledgeSections, loadOrganizationPolicies, type OrganizationPolicies } from "@/modules/vachat/policies";

export const VACHAT_ASSISTANT_ACCOUNT = "post@post.com";
export const VACHAT_ASSISTANT_NAME = "Order management WhatsApp AI Assistant";
export const VACHAT_BUSINESS_WHATSAPP = "+918618456029";
export const CUSTOMER_PHONE_ONLY_REPLY =
  "I can only share order, shipment, invoice, and tracking details for the WhatsApp number that placed the order.";
export const POSTBUS_PUBLIC_TRACK_URL = `${siteConfig.url}/track`;

export function postbusTrackingLink(trackingNumber?: string | null) {
  const id = trackingNumber?.trim();
  if (!id) return POSTBUS_PUBLIC_TRACK_URL;
  return customerTrackingLink(POSTBUS_PUBLIC_TRACK_URL, id);
}

export type TrackingTimelineItem = {
  at: string | null;
  office: string | null;
  description: string | null;
};

export type MerchantKnowledgeOrder = {
  orderNumber: string;
  customerPhone: string | null;
  customerName: string | null;
  createdAt?: string | null;
  status: string;
  paymentStatus: string | null;
  amount: string | null;
  items: string[];
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceTotal: string | null;
  trackingNumber: string | null;
  shipmentStatus: string | null;
  bookedAt: string | null;
  shipmentWeightGrams?: string | null;
  lastScan: string | null;
  lastOffice: string | null;
  trackingUrl: string | null;
  timeline: TrackingTimelineItem[];
};

export type MerchantKnowledge = {
  merchantId: string;
  organization: {
    name: string;
    phone: string | null;
    website: string | null;
    email: string | null;
    gstin: string | null;
    address: string | null;
  };
  policies?: OrganizationPolicies | null;
  orders: MerchantKnowledgeOrder[];
};

function asList<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function firstRelated<T>(value: T | T[] | null | undefined): T | null {
  return asList(value)[0] ?? null;
}

function money(value: unknown) {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  return amount.toFixed(2).endsWith(".00") ? String(Math.trunc(amount)) : amount.toFixed(2);
}

export function phoneDigitsForLookup(raw?: string | null) {
  if (!raw) return null;
  return extractIndiaMobileDigits(raw) ?? (raw.replace(/\D/g, "").slice(-10) || null);
}

export function customerPhonesMatch(left?: string | null, right?: string | null) {
  const a = phoneDigitsForLookup(left);
  const b = phoneDigitsForLookup(right);
  return Boolean(a && b && a === b);
}

export function filterKnowledgeOrdersForPhone(orders: MerchantKnowledgeOrder[], phone?: string | null) {
  if (!phoneDigitsForLookup(phone)) return [];
  return orders.filter((order) => customerPhonesMatch(order.customerPhone, phone));
}

export function formatMerchantOnlyKnowledgeDocument(
  knowledge: Pick<MerchantKnowledge, "organization" | "policies">
) {
  const org = knowledge.organization;
  return [
    `${VACHAT_ASSISTANT_NAME}. VaChat account ${VACHAT_ASSISTANT_ACCOUNT}. Read-only PostBus merchant profile for ${org.name}.`,
    "Do not answer customer-specific order status, tracking, shipment, or invoice questions from this knowledge.",
    `Merchant name: ${org.name}.`,
    org.phone ? `Merchant phone: ${org.phone}.` : null,
    org.website ? `Website: ${org.website}.` : null,
    org.email ? `Email: ${org.email}.` : null,
    org.gstin ? `GSTIN: ${org.gstin}.` : null,
    org.address ? `Address: ${org.address}.` : null,
    ...formatPolicyKnowledgeSections(knowledge.policies),
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatKnowledgeDocument(knowledge: MerchantKnowledge) {
  const org = knowledge.organization;
  const lines = [
    `${VACHAT_ASSISTANT_NAME}. VaChat account ${VACHAT_ASSISTANT_ACCOUNT}. Read-only PostBus tenant data for ${org.name}.`,
    "Use only records whose Customer WhatsApp matches the sender. Never share another customer's order, shipment, invoice, tracking ID, or timeline.",
    `Merchant name: ${org.name}.`,
    org.phone ? `Merchant phone: ${org.phone}.` : null,
    org.website ? `Website: ${org.website}.` : null,
    org.email ? `Email: ${org.email}.` : null,
    org.gstin ? `GSTIN: ${org.gstin}.` : null,
    org.address ? `Address: ${org.address}.` : null,
    "Answer order information, shipment information, India Post tracking ID, tracking timeline, and invoice from this data.",
  ].filter(Boolean) as string[];
  for (const order of knowledge.orders) {
    const timeline = order.timeline
      .slice(0, 12)
      .map((item) =>
        [item.at, item.office, item.description].filter(Boolean).join(" ")
      )
      .filter(Boolean)
      .join(" | ");
    lines.push(
      [
        `Customer WhatsApp ${order.customerPhone ?? "unknown"}`,
        order.customerName ? `customer ${order.customerName}` : null,
        `Order ${order.orderNumber}`,
        `order status ${order.status}`,
        order.paymentStatus ? `payment ${order.paymentStatus}` : null,
        order.amount ? `amount ${order.amount}` : null,
        order.items.length ? `items ${order.items.join("; ")}` : null,
        order.invoiceNumber ? `invoice ${order.invoiceNumber}` : null,
        order.invoiceDate ? `invoice date ${order.invoiceDate}` : null,
        order.invoiceTotal ? `invoice total ${order.invoiceTotal}` : null,
        order.trackingNumber ? `India Post tracking ID ${order.trackingNumber}` : null,
        order.shipmentStatus ? `shipment ${order.shipmentStatus}` : null,
        order.bookedAt ? `shipped ${order.bookedAt}` : null,
        order.lastScan ? `now ${order.lastScan}` : null,
        order.lastOffice ? `at ${order.lastOffice}` : null,
        `track ${postbusTrackingLink(order.trackingNumber)}`,
        timeline ? `timeline ${timeline}` : null,
      ]
        .filter(Boolean)
        .join(". ") + "."
    );
  }
  return lines.join("\n");
}

async function loadOrgKnowledge(
  supabase: SupabaseClient,
  organizationId: string
): Promise<MerchantKnowledge["organization"] | null> {
  const [{ data: org }, { data: invoice }, trackingPage] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, phone, line1, line2, city, state, pincode")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("invoice_settings")
      .select("website, business_email, gstin")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    getTrackingPage(supabase, organizationId).catch(() => null),
  ]);
  if (!org?.id) return null;
  const website =
    (typeof invoice?.website === "string" && invoice.website.trim()) ||
    (typeof trackingPage?.social?.website === "string" && trackingPage.social.website.trim()) ||
    null;
  const phone = org.phone?.trim() || trackingPage?.phone?.trim() || trackingPage?.whatsapp?.trim() || null;
  const address = vachatSingleLine(
    [org.line1, org.line2, org.city, org.state, org.pincode].filter(Boolean).join(", ")
  );
  return {
    name: org.name?.trim() || "Merchant",
    phone,
    website,
    email:
      (typeof invoice?.business_email === "string" && invoice.business_email.trim()) ||
      trackingPage?.email ||
      null,
    gstin: (typeof invoice?.gstin === "string" && invoice.gstin.trim()) || null,
    address: address || null,
  };
}

export async function orderIdsForCustomerPhone(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string
) {
  const digits = phoneDigitsForLookup(phone);
  if (!digits) return [] as string[];
  const like = `%${digits}`;
  const [{ data: customers }, { data: addresses }] = await Promise.all([
    supabase.from("customers").select("id, phone").eq("organization_id", organizationId).like("phone", like),
    supabase.from("addresses").select("id, phone").eq("organization_id", organizationId).like("phone", like),
  ]);
  const customerIds = asList(customers)
    .filter((row) => customerPhonesMatch(row.phone, phone))
    .map((row) => String(row.id));
  const addressIds = asList(addresses)
    .filter((row) => customerPhonesMatch(row.phone, phone))
    .map((row) => String(row.id));
  if (!customerIds.length && !addressIds.length) return [];
  let query = supabase.from("orders").select("id").eq("organization_id", organizationId);
  const filters = [
    customerIds.length ? `customer_id.in.(${customerIds.join(",")})` : null,
    addressIds.length ? `shipping_address_id.in.(${addressIds.join(",")})` : null,
  ].filter(Boolean) as string[];
  if (filters.length === 1) query = query.or(filters[0]);
  else query = query.or(filters.join(","));
  const { data: orders } = await query.order("created_at", { ascending: false }).limit(40);
  return asList(orders).map((row) => String(row.id)).filter(Boolean);
}

export async function loadMerchantKnowledge(
  supabase: SupabaseClient,
  organizationId: string,
  options?: { customerPhone?: string | null }
): Promise<MerchantKnowledge | null> {
  const organization = await loadOrgKnowledge(supabase, organizationId);
  if (!organization) return null;
  const policies = await loadOrganizationPolicies(supabase, organizationId);

  const customerPhone = options?.customerPhone ?? null;
  let orderQuery = supabase
    .from("orders")
    .select(
      "id, order_number, status, payment_status, total_amount, created_at, customer_id, shipping_address_id, customers(name, phone), addresses:shipping_address_id(name, phone)"
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (customerPhone) {
    const ids = await orderIdsForCustomerPhone(supabase, organizationId, customerPhone);
    if (!ids.length) {
      return { merchantId: organizationId, organization, policies, orders: [] };
    }
    orderQuery = orderQuery.in("id", ids);
  }

  const { data: orders } = await orderQuery;
  const orderRows = asList(orders);
  const orderIds = orderRows.map((row) => String(row.id));
  const empty = { data: [] as Array<Record<string, unknown>> };
  const [{ data: shipments }, { data: items }, { data: invoices }] =
    orderIds.length > 0
      ? await Promise.all([
          supabase
            .from("shipments")
            .select("id, order_id, status, tracking_number, barcode, booked_at, payment_mode, weight_grams")
            .eq("organization_id", organizationId)
            .in("order_id", orderIds),
          supabase
            .from("order_line_items")
            .select("order_id, title, quantity, sku")
            .eq("organization_id", organizationId)
            .in("order_id", orderIds),
          supabase
            .from("shipping_invoices")
            .select("order_id, invoice_number, invoice_date, total_amount, status, tracking_number")
            .eq("organization_id", organizationId)
            .in("order_id", orderIds),
        ])
      : [empty, empty, empty];

  const shipmentRows = asList(shipments);
  const shipmentIds = shipmentRows.map((row) => String(row.id));
  const { data: events } =
    shipmentIds.length > 0
      ? await supabase
          .from("tracking_events")
          .select("shipment_id, event_description, office_name, occurred_at, event_code")
          .eq("organization_id", organizationId)
          .in("shipment_id", shipmentIds)
          .order("occurred_at", { ascending: false })
          .limit(240)
      : { data: [] as Array<Record<string, unknown>> };

  const timelineByShipment = new Map<string, TrackingTimelineItem[]>();
  for (const event of asList(events)) {
    const id = String(event.shipment_id ?? "");
    if (!id) continue;
    const list = timelineByShipment.get(id) ?? [];
    if (list.length < 12) {
      list.push({
        at: event.occurred_at ? String(event.occurred_at) : null,
        office: event.office_name ? String(event.office_name) : null,
        description: event.event_description ? String(event.event_description) : event.event_code ? String(event.event_code) : null,
      });
      timelineByShipment.set(id, list);
    }
  }

  const itemsByOrder = new Map<string, string[]>();
  for (const item of asList(items)) {
    const orderId = String(item.order_id ?? "");
    if (!orderId) continue;
    const label = [item.quantity ? `${item.quantity}x` : null, item.title, item.sku ? `(${item.sku})` : null]
      .filter(Boolean)
      .join(" ");
    const list = itemsByOrder.get(orderId) ?? [];
    if (label) list.push(label);
    itemsByOrder.set(orderId, list);
  }

  const invoiceByOrder = new Map<
    string,
    { invoice_number?: string | null; invoice_date?: string | null; total_amount?: unknown }
  >();
  for (const invoice of asList(invoices as Array<Record<string, unknown>> | null)) {
    const orderId = String(invoice.order_id ?? "");
    if (orderId && !invoiceByOrder.has(orderId)) {
      invoiceByOrder.set(orderId, {
        invoice_number: invoice.invoice_number ? String(invoice.invoice_number) : null,
        invoice_date: invoice.invoice_date ? String(invoice.invoice_date) : null,
        total_amount: invoice.total_amount,
      });
    }
  }

  const shipmentByOrder = new Map<string, (typeof shipmentRows)[number]>();
  for (const shipment of shipmentRows) {
    const orderId = String(shipment.order_id ?? "");
    if (orderId && !shipmentByOrder.has(orderId)) shipmentByOrder.set(orderId, shipment);
  }

  const knowledgeOrders: MerchantKnowledgeOrder[] = [];
  for (const order of orderRows) {
    const customer = firstRelated(order.customers as { name?: string | null; phone?: string | null } | { name?: string | null; phone?: string | null }[]);
    const address = firstRelated(order.addresses as { name?: string | null; phone?: string | null } | { name?: string | null; phone?: string | null }[]);
    const orderPhone = phoneDigitsForLookup(address?.phone ?? customer?.phone ?? null);
    if (customerPhone && !customerPhonesMatch(orderPhone, customerPhone)) continue;
    const shipment = shipmentByOrder.get(String(order.id));
    const trackingNumber = shipment
      ? String(shipment.tracking_number || shipment.barcode || "") || null
      : null;
    const timeline = shipment ? timelineByShipment.get(String(shipment.id)) ?? [] : [];
    const scan = timeline[0];
    const invoice = invoiceByOrder.get(String(order.id));
    knowledgeOrders.push({
      orderNumber: String(order.order_number ?? ""),
      customerPhone: orderPhone,
      customerName: address?.name ?? customer?.name ?? null,
      createdAt: order.created_at ? String(order.created_at) : null,
      status: String(order.status ?? ""),
      paymentStatus: order.payment_status ? String(order.payment_status) : null,
      amount: money(order.total_amount),
      items: itemsByOrder.get(String(order.id)) ?? [],
      invoiceNumber: invoice?.invoice_number ? String(invoice.invoice_number) : null,
      invoiceDate: invoice?.invoice_date ? String(invoice.invoice_date) : null,
      invoiceTotal: money(invoice?.total_amount),
      trackingNumber,
      shipmentStatus: shipment ? String(shipment.status ?? "") : null,
      bookedAt: shipment?.booked_at ? String(shipment.booked_at) : null,
      shipmentWeightGrams: shipment?.weight_grams != null ? String(shipment.weight_grams) : null,
      lastScan: scan?.description ?? null,
      lastOffice: scan?.office ?? null,
      trackingUrl: postbusTrackingLink(trackingNumber),
      timeline,
    });
  }

  return {
    merchantId: organizationId,
    organization,
    policies,
    orders: knowledgeOrders.filter((row) => row.orderNumber),
  };
}

export async function syncMerchantKnowledge(supabase: SupabaseClient, organizationId: string) {
  const platform = await getPlatformVachatConfig();
  if (!isPlatformVachatActive(platform)) return { synced: false, reason: "platform_off" as const };
  const knowledge = await loadMerchantKnowledge(supabase, organizationId);
  if (!knowledge) return { synced: false, reason: "missing_org" as const };
  const document = formatMerchantOnlyKnowledgeDocument(knowledge);
  const res = await fetch(`${platform.apiBaseUrl.replace(/\/$/, "")}/api/postbus/knowledge`, {
    method: "PUT",
    headers: vachatHeaders(platform.apiKey),
    body: JSON.stringify({
      account: VACHAT_ASSISTANT_ACCOUNT,
      tab: "knowledge",
      merchant_id: organizationId,
      assistant: VACHAT_ASSISTANT_NAME,
      read_only: true,
      merchant_name: knowledge.organization.name,
      document,
      organization: knowledge.organization,
      orders: [],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const message = `VaChat knowledge sync failed (${res.status})`;
    logError("vachat.knowledge.sync_failed", { organizationId, status: res.status });
    return { synced: false, reason: message };
  }
    logInfo("vachat.knowledge.synced", { organizationId, orders: 0 });
  return { synced: true, document };
}

export function scheduleMerchantKnowledgeSync(supabase: SupabaseClient, organizationId: string) {
  void syncMerchantKnowledge(supabase, organizationId).catch((error) => {
    logError("vachat.knowledge.sync_failed", {
      organizationId,
      message: error instanceof Error ? error.message : "unknown",
    });
  });
}

export async function findOrganizationsForCustomerPhone(supabase: SupabaseClient, phone: string) {
  const digits = phoneDigitsForLookup(phone);
  if (!digits) return [] as string[];
  const like = `%${digits}`;
  const [{ data: customers }, { data: addresses }] = await Promise.all([
    supabase.from("customers").select("organization_id, phone").like("phone", like),
    supabase.from("addresses").select("organization_id, phone").like("phone", like),
  ]);
  return [
    ...new Set(
      [...asList(customers), ...asList(addresses)]
        .filter((row) => customerPhonesMatch(row?.phone, phone))
        .map((row) => String(row?.organization_id ?? ""))
        .filter(Boolean)
    ),
  ];
}
