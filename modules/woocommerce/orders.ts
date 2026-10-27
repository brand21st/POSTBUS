import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { getAutomationSettings } from "@/modules/automation/service";
import { isIndiaPostAcceptedStatus } from "@/modules/india-post/booking-status";
import { createShipmentsForOrders } from "@/modules/shipments/service";
import {
  getWooProduct,
  getWooVariation,
  listWooOrders,
  type WooCredentials,
  type WooTransport,
} from "@/modules/woocommerce/client";
import {
  mapWooOrder,
  mergeWooMeasures,
  wooParcelFromLines,
  type MappedWooOrder,
  type WooProductMeasure,
  type WooRemoteOrder,
} from "@/modules/woocommerce/map-order";
import { wooHasMorePages, wooOrderListQuery, type WooSyncWindow } from "@/modules/woocommerce/sync-window";
import { readWooMeasurementUnits } from "@/modules/woocommerce/units";

type ConnectionSettings = {
  eligibleStatuses?: string[];
  importDays?: number;
  customAfter?: string | null;
  customBefore?: string | null;
  addTrackingNote?: boolean;
  updateOrderStatus?: boolean;
  statusMap?: Record<string, string>;
  webhookIds?: number[];
};

export type WooConnectionRow = {
  id: string;
  organization_id: string;
  store_url: string;
  store_host: string;
  encrypted_consumer_key?: string | null;
  encrypted_consumer_secret?: string | null;
  encrypted_webhook_secret?: string | null;
  status: string;
  sync_enabled?: boolean;
  auth_state?: string | null;
  auth_state_expires_at?: string | null;
  auth_state_used_at?: string | null;
  weight_unit?: string | null;
  dimension_unit?: string | null;
  settings?: ConnectionSettings | null;
  last_sync_at?: string | null;
  last_successful_sync_at?: string | null;
  last_webhook_at?: string | null;
  last_error?: string | null;
  installed_at?: string | null;
};

export function wooSettings(row?: { settings?: ConnectionSettings | null } | null): ConnectionSettings {
  return row?.settings ?? {};
}

function tenant(organizationId: string, userId?: string): TenantContext {
  return {
    userId: userId ?? "",
    email: null,
    fullName: null,
    organizationId,
    organizationName: "",
    role: "OWNER",
    permissions: [],
  };
}

const WOO_PARCEL_LOCKED_ORDER = new Set(["BOOKED", "SHIPPED", "IN_TRANSIT", "DELIVERED", "CANCELLED"]);
const WOO_PARCEL_LOCKED_SHIPMENT = new Set([
  "VALIDATING",
  "QUEUED",
  "BOOKING",
  "BOOKED",
  "LABEL_PENDING",
  "LABEL_READY",
  "MANIFEST_PENDING",
  "MANIFEST_READY",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "NDR",
]);

export async function loadWooProductMeasures(
  creds: WooCredentials,
  orders: WooRemoteOrder[],
  transport?: WooTransport
) {
  const products = new Map<number, WooProductMeasure>();
  const cache = new Map<string, WooProductMeasure>();

  async function parentProduct(productId: number) {
    if (products.has(productId)) return products.get(productId) ?? {};
    try {
      const product = (await getWooProduct(creds, productId, transport)) ?? {};
      products.set(productId, product);
      return product;
    } catch {
      products.set(productId, {});
      return {};
    }
  }

  for (const order of orders) {
    for (const line of order.line_items ?? []) {
      const productId = Number(line.product_id) || 0;
      const variationId = Number(line.variation_id) || 0;
      if (!productId) continue;
      const key = `${productId}:${variationId}`;
      if (cache.has(key)) continue;
      const parent = await parentProduct(productId);
      if (!variationId) {
        cache.set(key, parent);
        continue;
      }
      try {
        const variation = (await getWooVariation(creds, productId, variationId, transport)) ?? {};
        cache.set(key, mergeWooMeasures(variation, parent));
      } catch {
        cache.set(key, parent);
      }
    }
  }
  return cache;
}

export async function upsertWooCommerceOrder(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    storeHost: string;
    remote: WooRemoteOrder;
    eligibleStatuses?: string[] | null;
    weightUnit?: string | null;
    dimensionUnit?: string | null;
    measures?: Map<string, WooProductMeasure>;
    userId?: string;
    applyAutomation?: boolean;
  }
) {
  const mapped = mapWooOrder(input.remote, {
    eligibleStatuses: input.eligibleStatuses,
    weightUnit: input.weightUnit,
    dimensionUnit: input.dimensionUnit,
    measures: input.measures,
  });
  if (!mapped.sourceOrderId) {
    return { created: false, updated: false, skipped: true, orderId: null as string | null };
  }

  const { data: existingRef } = await supabase
    .from("external_order_references")
    .select("order_id")
    .eq("organization_id", input.organizationId)
    .eq("source", "WOOCOMMERCE")
    .eq("source_order_id", mapped.sourceOrderId)
    .maybeSingle();

  if (!existingRef && !mapped.eligible && !mapped.terminal) {
    return { created: false, updated: false, skipped: true, orderId: null as string | null };
  }

  if (existingRef?.order_id) {
    const orderId = existingRef.order_id as string;
    const { data: shipment } = await supabase
      .from("shipments")
      .select("id, status")
      .eq("organization_id", input.organizationId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const accepted = isIndiaPostAcceptedStatus(shipment?.status);
    const { data: current } = await supabase
      .from("orders")
      .select("metadata, status")
      .eq("id", orderId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    const metadata = {
      ...((current?.metadata as Record<string, unknown> | null) ?? {}),
      ...mapped.metadata,
      woocommerce: {
        ...((current?.metadata as { woocommerce?: Record<string, unknown> } | null)?.woocommerce ?? {}),
        ...mapped.metadata.woocommerce,
      },
    };
    if (accepted) {
      await supabase
        .from("orders")
        .update({ metadata })
        .eq("id", orderId)
        .eq("organization_id", input.organizationId);
      return { created: false, updated: true, skipped: false, orderId };
    }
    await supabase
      .from("orders")
      .update({
        status: mapped.terminal ? "CANCELLED" : mapped.status,
        currency: mapped.currency,
        subtotal: mapped.subtotal,
        discount: mapped.discount,
        shipping_amount: mapped.shippingAmount,
        tax_amount: mapped.taxAmount,
        total_amount: mapped.total,
        payment_status: mapped.payment.paymentStatus,
        amount_paid: mapped.payment.amountPaid,
        cod_amount: mapped.payment.codAmount,
        metadata,
      })
      .eq("id", orderId)
      .eq("organization_id", input.organizationId);
    const { data: order } = await supabase
      .from("orders")
      .select("customer_id, shipping_address_id, billing_address_id")
      .eq("id", orderId)
      .maybeSingle();
    if (order?.customer_id) {
      await supabase
        .from("customers")
        .update({
          name: mapped.customer.name,
          phone: mapped.customer.phone,
          email: mapped.customer.email,
        })
        .eq("id", order.customer_id);
    }
    if (order?.shipping_address_id) {
      await supabase.from("addresses").update(addressRow(mapped.shipping)).eq("id", order.shipping_address_id);
    }
    if (order?.billing_address_id && order.billing_address_id !== order.shipping_address_id) {
      await supabase.from("addresses").update(addressRow(mapped.billing)).eq("id", order.billing_address_id);
    }
    const { data: existingLines } = await supabase
      .from("order_line_items")
      .select("title, sku, weight_grams, weight_edited")
      .eq("order_id", orderId)
      .eq("organization_id", input.organizationId);
    await supabase.from("order_line_items").delete().eq("order_id", orderId).eq("organization_id", input.organizationId);
    if (mapped.lines.length) {
      await supabase.from("order_line_items").insert(
        preserveEditedWooLineWeights(mapped.lines, existingLines ?? []).map((line) => ({
          organization_id: input.organizationId,
          order_id: orderId,
          title: line.title,
          sku: line.sku,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          weight_grams: line.weightGrams,
          weight_edited: line.weightEdited,
        }))
      );
    }
    await applyWooParcelHydrate(supabase, {
      organizationId: input.organizationId,
      orderId,
      orderStatus: mapped.terminal ? "CANCELLED" : mapped.status,
      mapped,
      userId: input.userId,
    });
    if (input.applyAutomation !== false) {
      await maybeAutoShip(supabase, input, mapped, orderId);
    }
    return { created: false, updated: true, skipped: false, orderId };
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({
      organization_id: input.organizationId,
      name: mapped.customer.name,
      phone: mapped.customer.phone,
      email: mapped.customer.email,
    })
    .select("id")
    .single();
  if (customerError || !customer) throw new Error(customerError?.message || "Could not save the customer.");

  const { data: shipping, error: shippingError } = await supabase
    .from("addresses")
    .insert({
      organization_id: input.organizationId,
      customer_id: customer.id,
      kind: "shipping",
      ...addressRow(mapped.shipping),
    })
    .select("id")
    .single();
  if (shippingError || !shipping) throw new Error(shippingError?.message || "Could not save the shipping address.");

  const { data: billing, error: billingError } = await supabase
    .from("addresses")
    .insert({
      organization_id: input.organizationId,
      customer_id: customer.id,
      kind: "billing",
      ...addressRow(mapped.billing),
    })
    .select("id")
    .single();
  if (billingError || !billing) throw new Error(billingError?.message || "Could not save the billing address.");

  const orderPayload = {
    organization_id: input.organizationId,
    source: "WOOCOMMERCE",
    source_order_id: mapped.sourceOrderId,
    customer_id: customer.id,
    shipping_address_id: shipping.id,
    billing_address_id: billing.id,
    currency: mapped.currency,
    subtotal: mapped.subtotal,
    discount: mapped.discount,
    shipping_amount: mapped.shippingAmount,
    tax_amount: mapped.taxAmount,
    total_amount: mapped.total,
    payment_status: mapped.payment.paymentStatus,
    amount_paid: mapped.payment.amountPaid,
    cod_amount: mapped.payment.codAmount,
    fulfillment_status: mapped.terminal ? "CANCELLED" : "UNFULFILLED",
    status: mapped.status,
    metadata: mapped.metadata,
  };

  let inserted = await supabase
    .from("orders")
    .insert({ ...orderPayload, order_number: mapped.orderNumber })
    .select("id")
    .single();
  if (inserted.error?.code === "23505") {
    inserted = await supabase
      .from("orders")
      .insert({ ...orderPayload, order_number: `WC-${mapped.sourceOrderId}` })
      .select("id")
      .single();
  }
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Could not save the WooCommerce order.");
  const orderId = inserted.data.id as string;

  if (mapped.lines.length) {
    const { error: itemsError } = await supabase.from("order_line_items").insert(
      mapped.lines.map((line) => ({
        organization_id: input.organizationId,
        order_id: orderId,
        title: line.title,
        sku: line.sku,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        weight_grams: line.weightGrams,
        weight_edited: false,
      }))
    );
    if (itemsError) throw new Error(itemsError.message);
  }

  const { error: refError } = await supabase.from("external_order_references").insert({
    organization_id: input.organizationId,
    order_id: orderId,
    source: "WOOCOMMERCE",
    source_order_id: mapped.sourceOrderId,
    shop_domain: input.storeHost,
  });
  if (refError && refError.code !== "23505") throw new Error(refError.message);

  await supabase.from("audit_logs").insert({
    organization_id: input.organizationId,
    actor_id: input.userId || null,
    action: "order.imported",
    entity_type: "order",
    entity_id: orderId,
    after: { source: "WOOCOMMERCE", sourceOrderId: mapped.sourceOrderId },
  });

  await applyWooParcelHydrate(supabase, {
    organizationId: input.organizationId,
    orderId,
    orderStatus: mapped.status,
    mapped,
    userId: input.userId,
  });
  if (input.applyAutomation !== false) {
    await maybeAutoShip(supabase, input, mapped, orderId);
  }
  return { created: true, updated: false, skipped: false, orderId };
}

function wooWeightKey(title?: string | null, sku?: string | null) {
  return `${String(title ?? "").trim().toLowerCase()}|${String(sku ?? "").trim().toLowerCase()}`;
}

function preserveEditedWooLineWeights(
  lines: MappedWooOrder["lines"],
  existing: Array<{
    title?: string | null;
    sku?: string | null;
    weight_grams?: number | null;
    weight_edited?: boolean | null;
  }>
) {
  const edited = new Map<string, number | null>();
  for (const row of existing) {
    if (!row.weight_edited) continue;
    edited.set(wooWeightKey(row.title, row.sku), row.weight_grams ?? null);
  }
  return lines.map((line) => {
    const key = wooWeightKey(line.title, line.sku);
    if (!edited.has(key)) return { ...line, weightEdited: false };
    return { ...line, weightGrams: edited.get(key) ?? null, weightEdited: true };
  });
}

async function applyWooParcelHydrate(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    orderId: string;
    orderStatus?: string | null;
    mapped: MappedWooOrder;
    userId?: string;
  }
) {
  if (WOO_PARCEL_LOCKED_ORDER.has((input.orderStatus ?? "").toUpperCase())) return;
  const parcel = wooParcelFromLines(input.mapped.lines);
  if (parcel.weightGrams == null && parcel.lengthCm == null) return;

  const { data: shipments } = await supabase
    .from("shipments")
    .select("id, status, length_cm, width_cm, height_cm, weight_grams")
    .eq("organization_id", input.organizationId)
    .eq("order_id", input.orderId);
  const rows = Array.isArray(shipments) ? shipments : [];
  const unlocked = rows.filter(
    (row) => !WOO_PARCEL_LOCKED_SHIPMENT.has(String((row as { status?: string }).status ?? "").toUpperCase())
  );

  if (!rows.length) {
    if (parcel.lengthCm == null && parcel.weightGrams == null) return;
    try {
      await createShipmentsForOrders(supabase, tenant(input.organizationId, input.userId), [input.orderId], {
        enqueueBooking: false,
        runBookingNow: false,
        setOrderProcessing: false,
        ...(parcel.weightGrams != null ? { weightGrams: parcel.weightGrams } : {}),
        ...(parcel.lengthCm != null
          ? { lengthCm: parcel.lengthCm, widthCm: parcel.widthCm ?? undefined, heightCm: parcel.heightCm ?? undefined }
          : {}),
      });
    } catch {
      // Parcel hydrate is optional; order import should still succeed.
    }
    return;
  }

  const { data: order } = await supabase
    .from("orders")
    .select("parcel_weight_mode")
    .eq("id", input.orderId)
    .maybeSingle();
  const autoWeight =
    String((order as { parcel_weight_mode?: string } | null)?.parcel_weight_mode ?? "auto").toLowerCase() !== "manual";

  for (const row of unlocked as Array<{
    id: string;
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
    weight_grams?: number | null;
  }>) {
    const hasDims = Number(row.length_cm) > 0 && Number(row.width_cm) > 0 && Number(row.height_cm) > 0;
    const patch: Record<string, number> = {};
    if (!hasDims && parcel.lengthCm != null && parcel.widthCm != null && parcel.heightCm != null) {
      patch.length_cm = parcel.lengthCm;
      patch.width_cm = parcel.widthCm;
      patch.height_cm = parcel.heightCm;
    }
    if (autoWeight && parcel.weightGrams != null && parcel.weightGrams >= 1) {
      patch.weight_grams = parcel.weightGrams;
    }
    if (!Object.keys(patch).length) continue;
    await supabase
      .from("shipments")
      .update(patch)
      .eq("id", row.id)
      .eq("organization_id", input.organizationId);
  }
}

function addressRow(address: {
  name: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
}) {
  return {
    name: address.name,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode || "000000",
    country: address.country || "IN",
  };
}

async function maybeAutoShip(
  supabase: SupabaseClient,
  input: { organizationId: string; userId?: string },
  mapped: ReturnType<typeof mapWooOrder>,
  orderId: string
) {
  if (mapped.terminal || mapped.issues.length || !mapped.eligible) return;
  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, status")
    .eq("organization_id", input.organizationId)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (shipment && (isIndiaPostAcceptedStatus(shipment.status) || shipment.status === "BOOKING" || shipment.status === "QUEUED")) {
    return;
  }
  let automation;
  try {
    automation = await getAutomationSettings(supabase, input.organizationId);
  } catch {
    return;
  }
  if (!automation.autoShipmentCreation) return;
  const pending = mapped.payment.paymentStatus === "PENDING";
  await createShipmentsForOrders(supabase, tenant(input.organizationId, input.userId), [orderId], {
    enqueueBooking: Boolean(automation.autoBooking) && !pending,
  });
}

export async function markWooOrderDeleted(
  supabase: SupabaseClient,
  organizationId: string,
  sourceOrderId: string
) {
  const { data: ref } = await supabase
    .from("external_order_references")
    .select("order_id")
    .eq("organization_id", organizationId)
    .eq("source", "WOOCOMMERCE")
    .eq("source_order_id", sourceOrderId)
    .maybeSingle();
  if (!ref?.order_id) return { updated: false, orderId: null as string | null };
  const orderId = ref.order_id as string;
  const { data: shipment } = await supabase
    .from("shipments")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("order_id", orderId)
    .limit(1)
    .maybeSingle();
  if (isIndiaPostAcceptedStatus(shipment?.status)) {
    return { updated: false, orderId };
  }
  await supabase
    .from("orders")
    .update({ status: "CANCELLED", fulfillment_status: "CANCELLED" })
    .eq("id", orderId)
    .eq("organization_id", organizationId);
  return { updated: true, orderId };
}

export async function syncWooCommercePage(
  supabase: SupabaseClient,
  input: {
    connection: WooConnectionRow;
    credentials: WooCredentials;
    userId?: string;
    page?: number;
    force?: boolean;
    transport?: WooTransport;
  }
) {
  const settings = wooSettings(input.connection);
  const window: WooSyncWindow = {
    importDays: settings.importDays,
    customAfter: settings.customAfter,
    customBefore: settings.customBefore,
    lastSuccessfulSyncAt: input.connection.last_successful_sync_at,
    incremental: Boolean(input.connection.last_successful_sync_at) && !settings.customAfter && !input.force,
  };
  const page = input.page && input.page > 0 ? input.page : 1;
  const listed = await listWooOrders(input.credentials, wooOrderListQuery(window, page), input.transport);
  const measures = await loadWooProductMeasures(input.credentials, listed.orders, input.transport);
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  for (const remote of listed.orders) {
    const result = await upsertWooCommerceOrder(supabase, {
      organizationId: input.connection.organization_id,
      storeHost: input.connection.store_host,
      remote,
      eligibleStatuses: settings.eligibleStatuses,
      weightUnit: input.connection.weight_unit,
      dimensionUnit: input.connection.dimension_unit,
      measures,
      userId: input.userId,
    });
    if (result.created) imported += 1;
    else if (result.updated) updated += 1;
    else skipped += 1;
  }
  const hasMore = wooHasMorePages(page, listed.totalPages);
  return { imported, updated, skipped, hasMore, nextPage: hasMore ? page + 1 : null };
}

export function measurementUnitsFromSettings(settings: Array<{ id?: string; value?: string }>) {
  return readWooMeasurementUnits(settings);
}
