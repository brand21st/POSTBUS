import type { SupabaseClient } from "@supabase/supabase-js";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { vachatSingleLine } from "@/modules/vachat/notice-fields";
import { getPlatformVachatConfig, isPlatformVachatActive } from "@/modules/vachat/platform-config";
import { vachatHeaders } from "@/modules/vachat/service";
import { resolveWatiTrackingUrl } from "@/modules/wati/send";
import { getTrackingPage } from "@/modules/tracking-pages/service";
import { logError, logInfo } from "@/lib/logger";

export const VACHAT_ASSISTANT_ACCOUNT = "post@post.com";
export const VACHAT_ASSISTANT_NAME = "Order management WhatsApp AI Assistant";

export type MerchantKnowledgeOrder = {
  orderNumber: string;
  status: string;
  amount: string | null;
  trackingNumber: string | null;
  shipmentStatus: string | null;
  bookedAt: string | null;
  lastScan: string | null;
  lastOffice: string | null;
  trackingUrl: string | null;
};

export type MerchantKnowledge = {
  merchantId: string;
  organization: {
    name: string;
    phone: string | null;
    website: string | null;
    email: string | null;
    address: string | null;
  };
  orders: MerchantKnowledgeOrder[];
};

function asList<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function money(value: unknown) {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  return amount.toFixed(2).endsWith(".00") ? String(Math.trunc(amount)) : amount.toFixed(2);
}

export function formatKnowledgeDocument(knowledge: MerchantKnowledge) {
  const org = knowledge.organization;
  const lines = [
    `${VACHAT_ASSISTANT_NAME}. Read-only PostBus data for ${org.name}.`,
    `Merchant name: ${org.name}.`,
    org.phone ? `Merchant phone: ${org.phone}.` : null,
    org.website ? `Website: ${org.website}.` : null,
    org.email ? `Email: ${org.email}.` : null,
    org.address ? `Address: ${org.address}.` : null,
    "Answer only order, tracking, and merchant contact questions from this data.",
  ].filter(Boolean) as string[];
  for (const order of knowledge.orders) {
    lines.push(
      [
        `Order ${order.orderNumber}`,
        `status ${order.status}`,
        order.amount ? `amount ${order.amount}` : null,
        order.trackingNumber ? `tracking ${order.trackingNumber}` : null,
        order.shipmentStatus ? `shipment ${order.shipmentStatus}` : null,
        order.bookedAt ? `shipped ${order.bookedAt}` : null,
        order.lastScan ? `now ${order.lastScan}` : null,
        order.lastOffice ? `at ${order.lastOffice}` : null,
        order.trackingUrl ? `track ${order.trackingUrl}` : null,
      ]
        .filter(Boolean)
        .join(". ") + "."
    );
  }
  return lines.join("\n");
}

export async function loadMerchantKnowledge(
  supabase: SupabaseClient,
  organizationId: string
): Promise<MerchantKnowledge | null> {
  const [{ data: org }, { data: invoice }, trackingPage] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, phone, line1, line2, city, state, pincode")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("invoice_settings")
      .select("website, business_email")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    getTrackingPage(supabase, organizationId).catch(() => null),
  ]);
  if (!org?.id) return null;

  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, status, total_amount")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(12);

  const orderRows = orders ?? [];
  const orderIds = orderRows.map((row) => row.id);
  const { data: shipments } =
    orderIds.length > 0
      ? await supabase
          .from("shipments")
          .select("id, order_id, status, tracking_number, barcode, booked_at")
          .eq("organization_id", organizationId)
          .in("order_id", orderIds)
      : { data: [] as Array<Record<string, unknown>> };

  const shipmentRows = shipments ?? [];
  const shipmentIds = shipmentRows.map((row) => String(row.id));
  const { data: events } =
    shipmentIds.length > 0
      ? await supabase
          .from("tracking_events")
          .select("shipment_id, event_description, office_name, occurred_at")
          .eq("organization_id", organizationId)
          .in("shipment_id", shipmentIds)
          .order("occurred_at", { ascending: false })
          .limit(40)
      : { data: [] as Array<Record<string, unknown>> };

  const latestEvent = new Map<string, { event_description?: string | null; office_name?: string | null; occurred_at?: string | null }>();
  for (const event of events ?? []) {
    const id = String(event.shipment_id ?? "");
    if (id && !latestEvent.has(id)) latestEvent.set(id, event);
  }

  const shipmentByOrder = new Map<string, (typeof shipmentRows)[number]>();
  for (const shipment of shipmentRows) {
    const orderId = String(shipment.order_id ?? "");
    if (orderId && !shipmentByOrder.has(orderId)) shipmentByOrder.set(orderId, shipment);
  }

  const knowledgeOrders: MerchantKnowledgeOrder[] = [];
  for (const order of orderRows) {
    const shipment = shipmentByOrder.get(order.id);
    const trackingNumber = shipment
      ? String(shipment.tracking_number || shipment.barcode || "") || null
      : null;
    const scan = shipment ? latestEvent.get(String(shipment.id)) : null;
    knowledgeOrders.push({
      orderNumber: String(order.order_number ?? ""),
      status: String(order.status ?? ""),
      amount: money(order.total_amount),
      trackingNumber,
      shipmentStatus: shipment ? String(shipment.status ?? "") : null,
      bookedAt: shipment?.booked_at ? String(shipment.booked_at) : null,
      lastScan: scan?.event_description ? String(scan.event_description) : null,
      lastOffice: scan?.office_name ? String(scan.office_name) : null,
      trackingUrl: trackingNumber ? resolveWatiTrackingUrl(trackingNumber, trackingPage) : null,
    });
  }

  const website =
    (typeof invoice?.website === "string" && invoice.website.trim()) ||
    (typeof trackingPage?.social?.website === "string" && trackingPage.social.website.trim()) ||
    null;
  const phone = org.phone?.trim() || trackingPage?.phone?.trim() || trackingPage?.whatsapp?.trim() || null;
  const address = vachatSingleLine(
    [org.line1, org.line2, org.city, org.state, org.pincode].filter(Boolean).join(", ")
  );

  return {
    merchantId: organizationId,
    organization: {
      name: org.name?.trim() || "Merchant",
      phone,
      website,
      email: (typeof invoice?.business_email === "string" && invoice.business_email.trim()) || trackingPage?.email || null,
      address: address || null,
    },
    orders: knowledgeOrders.filter((row) => row.orderNumber),
  };
}

export async function syncMerchantKnowledge(supabase: SupabaseClient, organizationId: string) {
  const platform = await getPlatformVachatConfig();
  if (!isPlatformVachatActive(platform)) return { synced: false, reason: "platform_off" as const };
  const knowledge = await loadMerchantKnowledge(supabase, organizationId);
  if (!knowledge) return { synced: false, reason: "missing_org" as const };
  const document = formatKnowledgeDocument(knowledge);
  const res = await fetch(`${platform.apiBaseUrl.replace(/\/$/, "")}/api/postbus/knowledge`, {
    method: "PUT",
    headers: vachatHeaders(platform.apiKey),
    body: JSON.stringify({
      account: VACHAT_ASSISTANT_ACCOUNT,
      merchant_id: organizationId,
      assistant: VACHAT_ASSISTANT_NAME,
      read_only: true,
      merchant_name: knowledge.organization.name,
      document,
      organization: knowledge.organization,
      orders: knowledge.orders,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const message = `VaChat knowledge sync failed (${res.status})`;
    logError("vachat.knowledge.sync_failed", { organizationId, status: res.status });
    return { synced: false, reason: message };
  }
  logInfo("vachat.knowledge.synced", { organizationId, orders: knowledge.orders.length });
  return { synced: true, document };
}

export function phoneDigitsForLookup(raw?: string | null) {
  if (!raw) return null;
  return extractIndiaMobileDigits(raw) ?? (raw.replace(/\D/g, "").slice(-10) || null);
}

export async function findOrganizationsForCustomerPhone(supabase: SupabaseClient, phone: string) {
  const digits = phoneDigitsForLookup(phone);
  if (!digits) return [] as string[];
  const like = `%${digits}`;
  const [{ data: customers }, { data: addresses }] = await Promise.all([
    supabase.from("customers").select("organization_id").like("phone", like),
    supabase.from("addresses").select("organization_id").like("phone", like),
  ]);
  return [
    ...new Set(
      [...asList(customers), ...asList(addresses)]
        .map((row) => String(row?.organization_id ?? ""))
        .filter(Boolean)
    ),
  ];
}
