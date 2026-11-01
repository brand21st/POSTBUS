import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { buildPostBusTrackingUrl } from "@/modules/tracking-pages/host";

function nestedOne(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function nestedRows(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

function addressDto(value: unknown) {
  const row = nestedOne(value);
  if (!row) return null;
  return {
    name: row.name ?? null,
    phone: extractIndiaMobileDigits(typeof row.phone === "string" ? row.phone : null) ?? row.phone ?? null,
    line1: row.line1 ?? null,
    line2: row.line2 ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    pincode: row.pincode ?? null,
    country: row.country ?? "IN",
  };
}

export function publicOrderDto(order: Record<string, unknown>, externalOrderId?: string | null) {
  const customer = nestedOne(order.customers) ?? nestedOne(order.customer);
  const shipments = nestedRows(order.shipments);
  return {
    id: order.id,
    order_number: order.order_number ?? order.orderNumber ?? null,
    external_order_id: externalOrderId ?? order.source_order_id ?? null,
    source: order.source ?? "API",
    status: order.status ?? null,
    payment_status: order.payment_status ?? order.paymentStatus ?? null,
    fulfillment_status: order.fulfillment_status ?? order.fulfillmentStatus ?? null,
    total_amount: order.total_amount ?? order.totalAmount ?? null,
    amount_paid: order.amount_paid ?? order.amountPaid ?? null,
    cod_amount: order.cod_amount ?? order.codAmount ?? null,
    extra_cod_charge: order.extra_cod_charge ?? order.extraCodCharge ?? 0,
    india_post_service: order.india_post_service ?? order.indiaPostService ?? null,
    parcel_weight_mode: order.parcel_weight_mode ?? order.parcelWeightMode ?? "auto",
    parcel_weight_grams: order.parcel_weight_grams ?? order.parcelWeightGrams ?? null,
    customer: customer
      ? {
          name: customer.name ?? null,
          phone:
            extractIndiaMobileDigits(typeof customer.phone === "string" ? customer.phone : null) ??
            customer.phone ??
            null,
          email: customer.email ?? null,
        }
      : null,
    shipping_address: addressDto(order.shipping_address) ?? addressDto(order.shippingAddress),
    billing_address: addressDto(order.billing_address) ?? addressDto(order.billingAddress),
    line_items: nestedRows(order.order_line_items ?? order.lineItems).map((item) => ({
      id: item.id ?? null,
      title: item.title ?? null,
      sku: item.sku ?? null,
      quantity: item.quantity ?? null,
      unit_price: item.unit_price ?? item.unitPrice ?? null,
      weight_grams: item.weight_grams ?? item.weightGrams ?? null,
    })),
    shipments: shipments.map((shipment) => ({
      id: shipment.id ?? null,
      status: shipment.status ?? null,
      barcode: shipment.barcode ?? null,
      tracking_number: shipment.tracking_number ?? shipment.trackingNumber ?? null,
    })),
    created_at: order.created_at ?? order.createdAt ?? null,
    updated_at: order.updated_at ?? order.updatedAt ?? null,
  };
}

export function publicShipmentDto(shipment: Record<string, unknown>) {
  const awb = (shipment.barcode ?? shipment.tracking_number ?? shipment.trackingNumber) as string | null;
  return {
    id: shipment.id,
    order_id: shipment.order_id ?? shipment.orderId ?? null,
    order_number: shipment.order_number ?? shipment.orderNumber ?? null,
    status: shipment.status ?? null,
    barcode: shipment.barcode ?? null,
    tracking_number: shipment.tracking_number ?? shipment.trackingNumber ?? null,
    tracking_url: awb ? buildPostBusTrackingUrl(String(awb)) : null,
    service_code: shipment.service_code ?? shipment.serviceCode ?? null,
    payment_mode: shipment.payment_mode ?? null,
    cod_amount: shipment.cod_amount ?? null,
    weight_grams: shipment.weight_grams ?? shipment.weightGrams ?? null,
    length_cm: shipment.length_cm ?? shipment.lengthCm ?? null,
    width_cm: shipment.width_cm ?? shipment.widthCm ?? null,
    height_cm: shipment.height_cm ?? shipment.heightCm ?? null,
    booked_at: shipment.booked_at ?? null,
    delivered_at: shipment.delivered_at ?? shipment.deliveredAt ?? null,
    last_event_at: shipment.last_event_at ?? shipment.lastEventAt ?? null,
    last_event_description: shipment.last_event_description ?? shipment.lastEventDescription ?? null,
    created_at: shipment.created_at ?? shipment.createdAt ?? null,
    updated_at: shipment.updated_at ?? shipment.updatedAt ?? null,
  };
}

export function publicTrackingDto(shipment: Record<string, unknown>) {
  const awb = (shipment.barcode ?? shipment.tracking_number) as string | null;
  const events = nestedRows(shipment.events ?? shipment.tracking_events).map((event) => ({
    event_code: event.event_code ?? event.eventCode ?? null,
    event_description: event.event_description ?? event.eventDescription ?? null,
    office_name: event.office_name ?? event.officeName ?? null,
    occurred_at: event.occurred_at ?? event.occurredAt ?? null,
    classification: event.classification ?? null,
  }));
  const status = String(shipment.status ?? "");
  return {
    shipment_id: shipment.id,
    awb: awb ?? null,
    status,
    tracking_url: awb ? buildPostBusTrackingUrl(String(awb)) : null,
    delivered: status.toUpperCase() === "DELIVERED" || Boolean(shipment.delivered_at),
    last_updated_at: shipment.last_event_at ?? shipment.last_tracked_at ?? shipment.updated_at ?? null,
    events,
  };
}

export function encodeCursor(updatedAt: string, id: string) {
  return Buffer.from(JSON.stringify({ u: updatedAt, i: id }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): { u: string; i: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { u?: string; i?: string };
    if (!parsed.u || !parsed.i) return null;
    return { u: parsed.u, i: parsed.i };
  } catch {
    return null;
  }
}
