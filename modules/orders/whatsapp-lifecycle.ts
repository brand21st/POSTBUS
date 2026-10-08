import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { settleOrderPayment } from "@/modules/orders/payment";
import {
  mergeWhatsappLifecycle,
  storefrontQuoteFromMetadata,
  whatsappLifecycleFromMetadata,
  whatsappPaymentRequirement,
} from "@/modules/orders/whatsapp-meta";
import { canonicalOrderNumber, formatWhatsAppOrderNumber } from "@/modules/orders/order-number";
import { parseWhatsAppOrderCommand, type WhatsAppOrderCommandKind } from "@/modules/orders/whatsapp-commands";
import { productImagePublicUrl } from "@/modules/products/images";
import {
  formatCustomerOrderCancelledMessage,
  formatCustomerOrderConfirmedMessage,
  formatCustomerPaymentAlreadySubmittedMessage,
  formatCustomerPaymentClaimedMessage,
  type StorefrontOrderMessage,
} from "@/modules/storefront/order-messages";
import {
  notifyCustomerPaymentConfirmed,
  notifyCustomerPaymentRejected,
  notifyCustomerPaymentRequired,
  notifyCustomerWhatsAppCancelled,
  notifyCustomerWhatsAppCodAccepted,
  notifyMerchantPaymentClaimed,
  notifyMerchantWhatsAppOrderReady,
} from "@/modules/storefront/order-notify";

const ORDER_SELECT =
  "id, organization_id, order_number, source, status, payment_status, total_amount, amount_paid, cod_amount, metadata, customer_id, customers(name, phone), addresses:shipping_address_id(line1, line2, city, state, pincode)";

type OrderRow = {
  id: string;
  organization_id: string;
  order_number: string;
  source: string;
  status: string;
  payment_status: string;
  total_amount: number | string | null;
  amount_paid: number | string | null;
  cod_amount: number | string | null;
  metadata: unknown;
  customer_id: string | null;
  customers?: { name?: string | null; phone?: string | null } | Array<{ name?: string | null; phone?: string | null }> | null;
  addresses?:
    | { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; pincode?: string | null }
    | Array<{ line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; pincode?: string | null }>
    | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function phonesMatch(a?: string | null, b?: string | null) {
  const left = extractIndiaMobileDigits(String(a ?? ""));
  const right = extractIndiaMobileDigits(String(b ?? ""));
  return Boolean(left && right && left === right);
}

async function organizationsForMerchantPhone(supabase: SupabaseClient, from: string) {
  const digits = extractIndiaMobileDigits(from);
  if (!digits) return [] as string[];
  const { data } = await supabase
    .from("organizations")
    .select("id, phone")
    .not("phone", "is", null)
    .or(`phone.eq.${digits},phone.eq.+91${digits},phone.ilike.%${digits}`);
  return (data ?? [])
    .filter((row) => extractIndiaMobileDigits(String(row.phone ?? "")) === digits)
    .map((row) => String(row.id));
}

function waOrderId(order: { order_number: string }) {
  return formatWhatsAppOrderNumber(order.order_number) || order.order_number;
}

async function loadWhatsAppOrdersByNumber(supabase: SupabaseClient, orderNumber: string) {
  const stored = canonicalOrderNumber(orderNumber) || orderNumber;
  const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("source", "WHATSAPP").eq("order_number", stored);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return (data ?? []) as OrderRow[];
}

async function storeName(supabase: SupabaseClient, organizationId: string) {
  const [{ data: settings }, { data: org }] = await Promise.all([
    supabase.from("storefront_settings").select("store_name").eq("organization_id", organizationId).maybeSingle(),
    supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
  ]);
  return String(settings?.store_name || org?.name || "Postbus");
}

async function orgPaymentMethods(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("storefront_settings")
    .select("upi_id, gpay_number, qr_image_path")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return {
    upiId: (data?.upi_id as string | null) ?? null,
    gpay: (data?.gpay_number as string | null) ?? null,
    qrImageUrl: productImagePublicUrl((data?.qr_image_path as string | null) ?? null),
  };
}

function settlementForRequirement(pay: ReturnType<typeof whatsappPaymentRequirement>, total: number) {
  if (pay.preference === "PREPAID" || (pay.amount >= total && total > 0)) {
    return settleOrderPayment({ paymentStatus: "PAID", totalAmount: total });
  }
  return settleOrderPayment({
    paymentStatus: "PARTIAL",
    totalAmount: total,
    amountPaid: pay.amount,
  });
}

async function toMessage(supabase: SupabaseClient, order: OrderRow, status: string): Promise<StorefrontOrderMessage> {
  const customer = one(order.customers);
  const address = one(order.addresses);
  const quote = storefrontQuoteFromMetadata(order.metadata);
  const { data: lines } = await supabase
    .from("order_line_items")
    .select("title, sku, quantity, unit_price")
    .eq("organization_id", order.organization_id)
    .eq("order_id", order.id);
  const metaItems = quote.items ?? [];
  const items =
    metaItems.length > 0
      ? metaItems.map((item) => ({
          name: String(item.name ?? "Item"),
          sku: item.sku ?? null,
          quantity: Number(item.quantity ?? 1),
          unitPrice: Number(item.unitPrice ?? 0),
          returnPolicy: item.returnPolicy === "Return Available" ? "Return Available" : "No Return",
        }))
      : (lines ?? []).map((line) => ({
          name: String(line.title),
          sku: (line.sku as string | null) ?? null,
          quantity: Number(line.quantity ?? 1),
          unitPrice: Number(line.unit_price ?? 0),
          returnPolicy: quote.returnPolicy === "Return Available" ? "Return Available" : "No Return",
        }));
  const advance = Number(quote.expectedAdvance ?? 0);
  const paymentMethod =
    quote.paymentPreference === "COD" ? (advance > 0 ? "COD with advance" : "Cash on delivery") : "Prepaid";
  return {
    storeName: await storeName(supabase, order.organization_id),
    orderNumber: order.order_number,
    customerName: customer?.name ?? "",
    whatsapp: extractIndiaMobileDigits(String(customer?.phone ?? "")) ?? String(customer?.phone ?? ""),
    line1: address?.line1 ?? "",
    line2: address?.line2 ?? null,
    city: address?.city ?? "",
    state: address?.state ?? "",
    pincode: address?.pincode ?? "",
    items,
    total: Number(quote.total ?? order.total_amount ?? 0),
    advanceAmount: advance,
    codAmount: Number(quote.amountOnDelivery ?? order.cod_amount ?? 0),
    paymentMethod,
    returnPolicy: quote.returnPolicy ?? "No Return",
    status,
  };
}

async function casUpdate(
  supabase: SupabaseClient,
  order: OrderRow,
  patch: Record<string, unknown>,
  extraEq?: Record<string, string>
) {
  const { data, error } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", order.id)
    .eq("organization_id", order.organization_id)
    .eq("source", "WHATSAPP")
    .eq("status", extraEq?.status ?? order.status)
    .eq("payment_status", extraEq?.payment_status ?? order.payment_status)
    .select("id, order_number, status, payment_status, metadata")
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return data;
}

async function audit(
  supabase: SupabaseClient,
  organizationId: string,
  orderId: string,
  action: string,
  after: Record<string, unknown>
) {
  await supabase.from("audit_logs").insert({
    organization_id: organizationId,
    actor_id: null,
    action,
    entity_type: "order",
    entity_id: orderId,
    after,
  });
}

export async function claimOnce(supabase: SupabaseClient, organizationId: string, key: string) {
  const { error } = await supabase.from("idempotency_keys").insert({
    organization_id: organizationId,
    key,
    request_hash: key,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  logError("whatsapp.idempotency.insert_failed", { organizationId, key, code: error.code, message: error.message });
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
}

type OrderMatch = { order: OrderRow | null; ambiguous: boolean };

function uniqueMatch(rows: OrderRow[]): OrderMatch {
  if (rows.length === 0) return { order: null, ambiguous: false };
  if (rows.length > 1) return { order: null, ambiguous: true };
  return { order: rows[0], ambiguous: false };
}

async function customerOrder(supabase: SupabaseClient, from: string, orderNumber: string): Promise<OrderMatch> {
  const rows = await loadWhatsAppOrdersByNumber(supabase, orderNumber);
  return uniqueMatch(rows.filter((row) => phonesMatch(from, one(row.customers)?.phone ?? null)));
}

async function merchantOrder(supabase: SupabaseClient, from: string, orderNumber: string): Promise<OrderMatch> {
  const orgIds = await organizationsForMerchantPhone(supabase, from);
  if (!orgIds.length) return { order: null, ambiguous: false };
  return uniqueMatch(rowsMatchingOrgs(await loadWhatsAppOrdersByNumber(supabase, orderNumber), orgIds));
}

function rowsMatchingOrgs(rows: OrderRow[], orgIds: string[]) {
  return rows.filter((row) => orgIds.includes(row.organization_id));
}

async function closeOpenPaymentClaims(supabase: SupabaseClient, order: OrderRow) {
  await supabase
    .from("order_payment_claims")
    .update({ status: "REJECTED", resolved_at: new Date().toISOString() })
    .eq("organization_id", order.organization_id)
    .eq("order_id", order.id)
    .eq("status", "OPEN");
}

async function notifyMerchantNewOrder(supabase: SupabaseClient, order: OrderRow) {
  const claimed = await claimOnce(supabase, order.organization_id, `whatsapp:merchant_new_order:${order.id}`);
  if (!claimed) return;
  const message = await toMessage(supabase, order, "Awaiting merchant");
  await notifyMerchantWhatsAppOrderReady(supabase, order.organization_id, message, order.id);
  try {
    await supabase.from("notifications").insert({
      organization_id: order.organization_id,
      type: "whatsapp.order_created",
      title: "New WhatsApp Order",
      body: `${waOrderId(order)} · ${one(order.customers)?.name ?? "Customer"}${
        Number(order.total_amount ?? 0) > 0 ? ` · ₹${order.total_amount}` : ""
      }`,
      entity_type: "order",
      entity_id: order.id,
    });
  } catch {
    // Dashboard alert is optional; WhatsApp merchant notice is the Phase 1 contract.
  }
}

async function handleCustomerYes(supabase: SupabaseClient, from: string, order: OrderRow) {
  const life = whatsappLifecycleFromMetadata(order.metadata);
  if (order.status === "CANCELLED") {
    return { handled: true as const, reply: `${waOrderId(order)} is already cancelled.` };
  }
  if (life.customer_confirmed_at) {
    return { handled: true as const, reply: `${waOrderId(order)} is already confirmed.` };
  }
  if (order.source !== "WHATSAPP" || order.status !== "IMPORTED" || order.payment_status !== "PENDING") {
    return { handled: true as const, reply: `${waOrderId(order)} can no longer be confirmed.` };
  }
  const now = new Date().toISOString();
  const metadata = mergeWhatsappLifecycle(order.metadata, {
    customer_confirmed_at: now,
    customer_confirmed_via: "whatsapp",
  });
  const { data: updated, error } = await supabase.rpc("cas_whatsapp_customer_confirm", {
    p_order_id: order.id,
    p_organization_id: order.organization_id,
    p_metadata: metadata,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!updated) {
    return { handled: true as const, reply: `${waOrderId(order)} is already confirmed.` };
  }
  await audit(supabase, order.organization_id, order.id, "order.whatsapp_customer_confirmed", {
    via: "whatsapp",
    from,
  });
  await notifyMerchantNewOrder(supabase, order);
  return { handled: true as const, reply: formatCustomerOrderConfirmedMessage(waOrderId(order)) };
}

async function handleCustomerNo(supabase: SupabaseClient, from: string, order: OrderRow) {
  const life = whatsappLifecycleFromMetadata(order.metadata);
  if (order.status === "CANCELLED") {
    return { handled: true as const, reply: formatCustomerOrderCancelledMessage(waOrderId(order)) };
  }
  if (life.customer_confirmed_at) {
    return { handled: true as const, reply: `${waOrderId(order)} is already confirmed and cannot be cancelled this way.` };
  }
  if (order.source !== "WHATSAPP" || order.status !== "IMPORTED" || order.payment_status !== "PENDING") {
    return { handled: true as const, reply: `${waOrderId(order)} can no longer be cancelled from WhatsApp.` };
  }
  const now = new Date().toISOString();
  const updated = await casUpdate(supabase, order, {
    status: "CANCELLED",
    metadata: mergeWhatsappLifecycle(order.metadata, { customer_cancelled_at: now }),
  });
  if (!updated) {
    return { handled: true as const, reply: `${waOrderId(order)} can no longer be cancelled from WhatsApp.` };
  }
  await closeOpenPaymentClaims(supabase, order);
  await audit(supabase, order.organization_id, order.id, "order.whatsapp_customer_cancelled", { from });
  return { handled: true as const, reply: formatCustomerOrderCancelledMessage(waOrderId(order)) };
}

function awaitingCustomerConfirmation(order: OrderRow) {
  return !whatsappLifecycleFromMetadata(order.metadata).customer_confirmed_at;
}

const BLOCKED_PROCESS_STATUSES = new Set(["CANCELLED", "BOOKED", "SHIPPED", "IN_TRANSIT", "DELIVERED"]);

async function notifyCustomerProcessOutcome(
  supabase: SupabaseClient,
  order: OrderRow,
  kind: "cod" | "payment_required",
  amount = 0
) {
  const claimed = await claimOnce(supabase, order.organization_id, `whatsapp:customer_process_notice:${order.id}`);
  if (!claimed) return;
  const phone = one(order.customers)?.phone;
  if (!phone) return;
  if (kind === "cod") {
    await notifyCustomerWhatsAppCodAccepted(supabase, order.organization_id, phone, order.order_number, order.id);
    return;
  }
  const methods = await orgPaymentMethods(supabase, order.organization_id);
  await notifyCustomerPaymentRequired(
    supabase,
    order.organization_id,
    phone,
    {
      orderNumber: order.order_number,
      amount,
      upiId: methods.upiId,
      gpay: methods.gpay,
      qrImageUrl: methods.qrImageUrl,
    },
    order.id
  );
  await audit(supabase, order.organization_id, order.id, "order.whatsapp_payment_requested", {
    amount,
    hasUpi: Boolean(methods.upiId),
    hasGpay: Boolean(methods.gpay),
    hasQr: Boolean(methods.qrImageUrl),
  });
}

async function handleMerchantProcess(supabase: SupabaseClient, from: string, order: OrderRow) {
  const life = whatsappLifecycleFromMetadata(order.metadata);
  if (order.status === "CANCELLED") {
    return { handled: true as const, reply: `${waOrderId(order)} is cancelled.` };
  }
  if (awaitingCustomerConfirmation(order)) {
    return { handled: true as const, reply: `Customer has not confirmed ${waOrderId(order)} yet.` };
  }
  if (order.status === "READY") {
    return { handled: true as const, reply: `${waOrderId(order)} is already processing.` };
  }
  if (life.merchant_processed_at || life.payment_required) {
    return {
      handled: true as const,
      reply: `${waOrderId(order)} is already accepted. Payment is still required.`,
    };
  }
  if (BLOCKED_PROCESS_STATUSES.has(order.status) || order.status !== "IMPORTED") {
    return { handled: true as const, reply: `${waOrderId(order)} cannot be processed in its current state.` };
  }

  const pay = whatsappPaymentRequirement(order.metadata, Number(order.total_amount ?? 0));
  const now = new Date().toISOString();

  if (!pay.required && pay.preference === "COD") {
    const updated = await casUpdate(supabase, order, {
      status: "READY",
      payment_status: "COD",
      amount_paid: 0,
      cod_amount: pay.amountOnDelivery,
      metadata: mergeWhatsappLifecycle(order.metadata, {
        merchant_processed_at: now,
        merchant_accepted_at: now,
        merchant_accepted_via: "whatsapp",
        payment_required: false,
        payment_required_amount: 0,
      }),
    });
    if (!updated) {
      return { handled: true as const, reply: `${waOrderId(order)} is already processing.` };
    }
    await audit(supabase, order.organization_id, order.id, "order.whatsapp_merchant_processed", {
      via: "whatsapp",
      from,
      payment: "COD",
    });
    await notifyCustomerProcessOutcome(supabase, order, "cod");
    return { handled: true as const, reply: `${waOrderId(order)} is READY for India Post (COD).` };
  }

  const updated = await casUpdate(supabase, order, {
    metadata: mergeWhatsappLifecycle(order.metadata, {
      merchant_processed_at: now,
      merchant_accepted_at: now,
      merchant_accepted_via: "whatsapp",
      payment_required: true,
      payment_required_amount: pay.amount,
    }),
  });
  if (!updated) {
    return {
      handled: true as const,
      reply: `${waOrderId(order)} is already accepted. Payment is still required.`,
    };
  }
  await audit(supabase, order.organization_id, order.id, "order.whatsapp_merchant_processed", {
    via: "whatsapp",
    from,
    payment: "required",
    amount: pay.amount,
  });
  await notifyCustomerProcessOutcome(supabase, order, "payment_required", pay.amount);
  return {
    handled: true as const,
    reply: `${waOrderId(order)} accepted. Payment request of ₹${pay.amount} sent to the customer.`,
  };
}

async function handleMerchantCancel(supabase: SupabaseClient, from: string, order: OrderRow) {
  if (awaitingCustomerConfirmation(order)) {
    return { handled: true as const, reply: `Customer has not confirmed ${waOrderId(order)} yet.` };
  }
  if (order.status === "CANCELLED") {
    return { handled: true as const, reply: `${waOrderId(order)} was rejected. The order remains in Postbus as cancelled.` };
  }
  if (order.status !== "IMPORTED") {
    return { handled: true as const, reply: `${waOrderId(order)} cannot be cancelled from WhatsApp in its current state.` };
  }
  const now = new Date().toISOString();
  const updated = await casUpdate(supabase, order, {
    status: "CANCELLED",
    metadata: mergeWhatsappLifecycle(order.metadata, { merchant_cancelled_at: now, merchant_accepted_via: "whatsapp" }),
  });
  if (!updated) {
    return { handled: true as const, reply: `${waOrderId(order)} cannot be cancelled from WhatsApp in its current state.` };
  }
  await closeOpenPaymentClaims(supabase, order);
  await audit(supabase, order.organization_id, order.id, "order.whatsapp_rejected", {
    reason: "Merchant cancelled from WhatsApp",
    from,
  });
  const claimed = await claimOnce(supabase, order.organization_id, `whatsapp:customer_cancel_notice:${order.id}`);
  const phone = one(order.customers)?.phone;
  if (claimed && phone) {
    await notifyCustomerWhatsAppCancelled(supabase, order.organization_id, phone, order.order_number, order.id);
  }
  return { handled: true as const, reply: `${waOrderId(order)} was rejected. The order remains in Postbus as cancelled.` };
}

async function openClaim(supabase: SupabaseClient, order: OrderRow, from: string, amount: number) {
  const { data: existing } = await supabase
    .from("order_payment_claims")
    .select("id, status")
    .eq("organization_id", order.organization_id)
    .eq("order_id", order.id)
    .eq("status", "OPEN")
    .maybeSingle();
  if (existing) return { duplicate: true as const, id: String(existing.id) };
  const { data, error } = await supabase
    .from("order_payment_claims")
    .insert({
      organization_id: order.organization_id,
      order_id: order.id,
      status: "OPEN",
      amount,
      customer_phone: extractIndiaMobileDigits(from) ?? from,
      claimed_via: "whatsapp",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505" || String(error.message ?? "").toLowerCase().includes("duplicate")) {
      return { duplicate: true as const, id: "" };
    }
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  }
  return { duplicate: false as const, id: String(data.id) };
}

async function handlePaymentClaim(supabase: SupabaseClient, from: string, order: OrderRow) {
  const life = whatsappLifecycleFromMetadata(order.metadata);
  if (order.status === "CANCELLED") {
    return { handled: true as const, reply: `${waOrderId(order)} is cancelled.` };
  }
  if (awaitingCustomerConfirmation(order) || !life.merchant_processed_at) {
    return { handled: true as const, reply: `${waOrderId(order)} is not waiting for a payment claim.` };
  }
  if (!life.payment_required || Number(life.payment_required_amount ?? 0) <= 0) {
    return { handled: true as const, reply: `${waOrderId(order)} does not require a payment claim.` };
  }
  if (order.status === "READY" || order.payment_status === "PAID") {
    return { handled: true as const, reply: `${waOrderId(order)} is already paid.` };
  }
  if (order.status !== "IMPORTED" || order.payment_status !== "PENDING") {
    return { handled: true as const, reply: `${waOrderId(order)} is not waiting for payment.` };
  }
  const pay = whatsappPaymentRequirement(order.metadata, Number(order.total_amount ?? 0));
  const amount = pay.amount;
  const claim = await openClaim(supabase, order, from, amount);
  if (claim.duplicate) {
    return { handled: true as const, reply: formatCustomerPaymentAlreadySubmittedMessage(waOrderId(order)) };
  }
  await audit(supabase, order.organization_id, order.id, "order.whatsapp_payment_claimed", {
    from,
    amount,
    claimId: claim.id,
  });
  await notifyMerchantPaymentClaimed(
    supabase,
    order.organization_id,
    {
      orderNumber: order.order_number,
      customerName: one(order.customers)?.name ?? "",
      amount,
    },
    order.id
  );
  return { handled: true as const, reply: formatCustomerPaymentClaimedMessage(waOrderId(order)) };
}

async function handlePaymentConfirm(supabase: SupabaseClient, from: string, order: OrderRow) {
  const life = whatsappLifecycleFromMetadata(order.metadata);
  if (awaitingCustomerConfirmation(order) || !life.merchant_processed_at || !life.payment_required) {
    return { handled: true as const, reply: `${waOrderId(order)} is not waiting for payment verification.` };
  }
  if (order.status === "CANCELLED") {
    return { handled: true as const, reply: `${waOrderId(order)} is cancelled.` };
  }
  if (order.status === "READY") {
    return { handled: true as const, reply: `${waOrderId(order)} payment was already verified.` };
  }
  const { data: claim } = await supabase
    .from("order_payment_claims")
    .select("id, amount, status")
    .eq("organization_id", order.organization_id)
    .eq("order_id", order.id)
    .eq("status", "OPEN")
    .maybeSingle();
  if (!claim) {
    return { handled: true as const, reply: `No open payment claim for ${waOrderId(order)}.` };
  }
  const pay = whatsappPaymentRequirement(order.metadata, Number(order.total_amount ?? 0));
  const total = Number(storefrontQuoteFromMetadata(order.metadata).total || order.total_amount || 0);
  let payment;
  try {
    payment = settlementForRequirement(pay, total);
  } catch {
    return { handled: true as const, reply: `Could not settle payment for ${waOrderId(order)}. Try again in Postbus.` };
  }
  const now = new Date().toISOString();
  const { data: resolved, error } = await supabase.rpc("resolve_whatsapp_payment_claim", {
    p_action: "CONFIRM",
    p_order_id: order.id,
    p_organization_id: order.organization_id,
    p_payment_status: payment.paymentStatus,
    p_amount_paid: payment.amountPaid,
    p_cod_amount: payment.codAmount,
    p_metadata: mergeWhatsappLifecycle(order.metadata, {
      merchant_accepted_at: life.merchant_accepted_at ?? now,
      merchant_accepted_via: "whatsapp",
    }),
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const result = String((resolved as { result?: string } | null)?.result ?? "");
  if (result === "already_confirmed") {
    return { handled: true as const, reply: `${waOrderId(order)} payment was already verified.` };
  }
  if (result === "cancelled") {
    return { handled: true as const, reply: `${waOrderId(order)} is cancelled.` };
  }
  if (result === "no_open_claim") {
    return { handled: true as const, reply: `No open payment claim for ${waOrderId(order)}.` };
  }
  if (result !== "confirmed") {
    return { handled: true as const, reply: `${waOrderId(order)} is not waiting for payment verification.` };
  }
  order.status = "READY";
  order.payment_status = payment.paymentStatus;
  order.amount_paid = payment.amountPaid;
  order.cod_amount = payment.codAmount;
  await audit(supabase, order.organization_id, order.id, "order.whatsapp_payment_confirmed", {
    from,
    amount: pay.amount,
    paymentStatus: payment.paymentStatus,
    claimId: claim.id,
  });
  const customerPhone = one(order.customers)?.phone;
  if (customerPhone) {
    await notifyCustomerPaymentConfirmed(
      supabase,
      order.organization_id,
      customerPhone,
      order.order_number,
      order.id
    );
  }
  return { handled: true as const, reply: `${waOrderId(order)} payment verified. Order is READY.` };
}

async function handlePaymentReject(supabase: SupabaseClient, from: string, order: OrderRow) {
  if (awaitingCustomerConfirmation(order)) {
    return { handled: true as const, reply: `Customer has not confirmed ${waOrderId(order)} yet.` };
  }
  if (order.status === "CANCELLED") {
    return { handled: true as const, reply: `${waOrderId(order)} is cancelled.` };
  }
  if (order.status === "READY") {
    return { handled: true as const, reply: `${waOrderId(order)} payment was already verified.` };
  }
  const { data: resolved, error } = await supabase.rpc("resolve_whatsapp_payment_claim", {
    p_action: "REJECT",
    p_order_id: order.id,
    p_organization_id: order.organization_id,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const result = String((resolved as { result?: string } | null)?.result ?? "");
  if (result === "already_confirmed") {
    return { handled: true as const, reply: `${waOrderId(order)} payment was already verified.` };
  }
  if (result === "cancelled") {
    return { handled: true as const, reply: `${waOrderId(order)} is cancelled.` };
  }
  if (result !== "rejected") {
    return { handled: true as const, reply: `No open payment claim for ${waOrderId(order)}.` };
  }
  await audit(supabase, order.organization_id, order.id, "order.whatsapp_payment_rejected", {
    from,
    claimId: (resolved as { claim_id?: string } | null)?.claim_id ?? null,
  });
  const customerPhone = one(order.customers)?.phone;
  if (customerPhone) {
    await notifyCustomerPaymentRejected(
      supabase,
      order.organization_id,
      customerPhone,
      order.order_number,
      order.id
    );
  }
  return {
    handled: true as const,
    reply: `Payment for ${waOrderId(order)} was not verified. The customer can claim again.`,
  };
}

function routeKind(kind: WhatsAppOrderCommandKind, asCustomer: boolean, asMerchant: boolean): WhatsAppOrderCommandKind {
  if (asCustomer && (kind === "CUSTOMER_YES" || kind === "CUSTOMER_NO" || kind === "PAYMENT_CLAIM")) return kind;
  if (asMerchant && kind === "CUSTOMER_YES") return "MERCHANT_PROCESS";
  if (asMerchant && kind === "CUSTOMER_NO") return "MERCHANT_CANCEL";
  return kind;
}

export async function handleWhatsAppStorefrontAction(
  supabase: SupabaseClient,
  input: { from: string; text: string }
) {
  const command = parseWhatsAppOrderCommand(input.text);
  if (!command) return { handled: false as const, reason: "not_action" };
  const displayRef = formatWhatsAppOrderNumber(command.orderNumber) || command.orderNumber;

  const [customerMatch, merchantMatch] = await Promise.all([
    customerOrder(supabase, input.from, command.orderNumber),
    merchantOrder(supabase, input.from, command.orderNumber),
  ]);

  if (customerMatch.ambiguous || merchantMatch.ambiguous) {
    return {
      handled: true as const,
      reply: `We could not match ${displayRef} to this WhatsApp number.`,
    };
  }

  const asCustomer = customerMatch.order;
  const asMerchant = merchantMatch.order;

  if (!asCustomer && !asMerchant) {
    return { handled: true as const, reply: `We could not match ${displayRef} to this WhatsApp number.` };
  }

  const kind = routeKind(command.kind, Boolean(asCustomer), Boolean(asMerchant));
  const order = (kind.startsWith("CUSTOMER") ? asCustomer : asMerchant) ?? asMerchant ?? asCustomer;
  if (!order) {
    return { handled: true as const, reply: `We could not match ${displayRef} to this WhatsApp number.` };
  }

  const withOrg = async (
    result: Promise<{ handled: true; reply: string } | { handled: false; reason: string }>
  ) => {
    const next = await result;
    return { ...next, organizationId: order.organization_id, orderId: order.id };
  };

  switch (kind) {
    case "CUSTOMER_YES":
      if (!asCustomer) return { handled: true as const, reply: `We could not confirm ${displayRef} for this number.` };
      return withOrg(handleCustomerYes(supabase, input.from, asCustomer));
    case "CUSTOMER_NO":
      if (!asCustomer) return { handled: true as const, reply: `We could not cancel ${displayRef} for this number.` };
      return withOrg(handleCustomerNo(supabase, input.from, asCustomer));
    case "MERCHANT_PROCESS":
      if (!asMerchant) return { handled: true as const, reply: `Only the merchant can process ${displayRef}.` };
      return withOrg(handleMerchantProcess(supabase, input.from, asMerchant));
    case "MERCHANT_CANCEL":
      if (!asMerchant) return { handled: true as const, reply: `Only the merchant can cancel ${displayRef}.` };
      return withOrg(handleMerchantCancel(supabase, input.from, asMerchant));
    case "PAYMENT_CLAIM":
      if (!asCustomer) return { handled: true as const, reply: `Only the customer can claim payment for ${displayRef}.` };
      return withOrg(handlePaymentClaim(supabase, input.from, asCustomer));
    case "PAYMENT_CONFIRM":
      if (!asMerchant) return { handled: true as const, reply: `Only the merchant can verify payment for ${displayRef}.` };
      return withOrg(handlePaymentConfirm(supabase, input.from, asMerchant));
    case "PAYMENT_REJECT":
      if (!asMerchant) return { handled: true as const, reply: `Only the merchant can reject payment for ${displayRef}.` };
      return withOrg(handlePaymentReject(supabase, input.from, asMerchant));
    default:
      return { handled: false as const, reason: "not_action" };
  }
}
