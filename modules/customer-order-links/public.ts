import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { hashSecret } from "@/lib/security/crypto";
import {
  CUSTOMER_ORDER_LINK_TOKEN,
  CUSTOMER_ORDER_PUBLIC_ID,
  CUSTOMER_ORDER_WORKSPACE,
  normalizeCustomerOrderLinkToken,
  type SubmitCustomerOrderLinkInput,
} from "@/modules/customer-order-links/schema";
import {
  indiaPostOfficeToApiRow,
  indiaPostOfficesForSelection,
} from "@/modules/india-post/endpoints";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { createOrderSchema } from "@/modules/orders/schema";
import { formatWhatsAppOrderNumber } from "@/modules/orders/order-number";
import { createManualOrder } from "@/modules/orders/service";
import { loadCatalogProducts } from "@/modules/products/service";
import { quoteCatalogPayment } from "@/modules/storefront/quote";

type PublicLinkRow = {
  id: string;
  organization_id: string;
  status: string;
  expires_at: string | null;
  public_workspace: string | null;
  public_code: string | null;
};

function invalidLink(): never {
  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "This link is not valid.");
}

export type PublicLinkRef =
  | { kind: "token"; token: string }
  | { kind: "path"; workspace: string; publicId?: string };

function assertToken(token: string) {
  if (!CUSTOMER_ORDER_LINK_TOKEN.test(normalizeCustomerOrderLinkToken(token))) invalidLink();
}

function assertPath(workspace: string, publicId?: string) {
  if (!CUSTOMER_ORDER_WORKSPACE.test(workspace)) invalidLink();
  if (publicId && !CUSTOMER_ORDER_PUBLIC_ID.test(publicId)) invalidLink();
}

const LINK_COLS = "id, organization_id, status, expires_at, public_workspace, public_code";

async function activeForOrg(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("customer_order_links")
    .select(LINK_COLS)
    .eq("organization_id", organizationId)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return (data as PublicLinkRow | null) ?? null;
}

async function findByToken(supabase: SupabaseClient, token: string) {
  assertToken(token);
  const { data, error } = await supabase
    .from("customer_order_links")
    .select(LINK_COLS)
    .eq("token_hash", hashSecret(normalizeCustomerOrderLinkToken(token)))
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const row = (data as PublicLinkRow | null) ?? null;
  if (!row) return null;
  if (row.status === "ACTIVE") return row;
  return activeForOrg(supabase, row.organization_id);
}

async function findByPath(supabase: SupabaseClient, workspace: string, publicId?: string) {
  assertPath(workspace, publicId);
  const { data, error } = await supabase
    .from("customer_order_links")
    .select(LINK_COLS)
    .eq("public_workspace", workspace)
    .eq("status", "ACTIVE")
    .limit(1)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (data) {
    const row = data as PublicLinkRow;
    if (publicId && row.public_code && row.public_code !== publicId) return null;
    return row;
  }

  let builder = supabase.from("customer_order_links").select(LINK_COLS).eq("public_workspace", workspace);
  if (publicId) builder = builder.eq("public_code", publicId);
  const { data: legacy, error: legacyError } = await builder.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (legacyError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, legacyError.message);
  const row = (legacy as PublicLinkRow | null) ?? null;
  if (!row) return null;
  return activeForOrg(supabase, row.organization_id);
}

export async function findPublicCollectionLink(supabase: SupabaseClient, ref: PublicLinkRef) {
  return ref.kind === "path" ? findByPath(supabase, ref.workspace, ref.publicId) : findByToken(supabase, ref.token);
}

async function findLink(supabase: SupabaseClient, ref: PublicLinkRef) {
  return findPublicCollectionLink(supabase, ref);
}

export type PublicLinkView = {
  status: "OPEN" | "SUBMITTED" | "EXPIRED" | "DISABLED";
  merchantName?: string | null;
};

async function merchantName(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

export async function getPublicCustomerOrderLink(
  supabase: SupabaseClient,
  ref: PublicLinkRef
): Promise<PublicLinkView> {
  const row = await findLink(supabase, ref);
  if (!row) invalidLink();
  if (row.status !== "ACTIVE") return { status: "DISABLED" };
  return {
    status: "OPEN",
    merchantName: await merchantName(supabase, row.organization_id),
  };
}

export type PublicPincodeOffice = {
  name: string;
  city: string;
  state: string;
};

export type PublicPincodeLookup = {
  pincode: string;
  offices: PublicPincodeOffice[];
};

export async function lookupPublicOrderLinkPincode(
  supabase: SupabaseClient,
  ref: PublicLinkRef,
  rawPincode: string
): Promise<PublicPincodeLookup> {
  const pincode = rawPincode.replace(/\D/g, "").slice(0, 6);
  if (!/^\d{6}$/.test(pincode)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a valid 6-digit PIN code.");
  }

  const row = await findLink(supabase, ref);
  if (!row || row.status !== "ACTIVE") invalidLink();

  const { data } = await supabase
    .from("india_post_connections")
    .select("*")
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  if (!data?.encrypted_username || !data?.encrypted_password) {
    return { pincode, offices: [] };
  }

  try {
    const offices = await indiaPostFromRow(data).searchPostOffices(pincode);
    const selected = indiaPostOfficesForSelection(offices);
    const shown = selected.length ? selected : offices.filter((office) => office.office_name);
    return {
      pincode,
      offices: shown.map((office) => {
        const rowOffice = indiaPostOfficeToApiRow(office, pincode);
        return {
          name: rowOffice.name,
          city: rowOffice.city,
          state: rowOffice.state,
        };
      }),
    };
  } catch {
    return { pincode, offices: [] };
  }
}

function catalogOnHand(row: { inventory_balances?: unknown }) {
  const value = row.inventory_balances;
  if (!value) return 0;
  if (Array.isArray(value)) return Number(value[0]?.on_hand ?? 0);
  if (typeof value === "object" && value && "on_hand" in value) {
    return Number((value as { on_hand?: number }).on_hand ?? 0);
  }
  return 0;
}

export async function submitPublicCustomerOrderLink(
  supabase: SupabaseClient,
  ref: PublicLinkRef,
  input: SubmitCustomerOrderLinkInput
) {
  const row = await findLink(supabase, ref);
  if (!row || row.status !== "ACTIVE") invalidLink();

  const phone = extractIndiaMobileDigits(input.phone);
  if (!phone) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a valid 10-digit Indian mobile number.");
  }

  const idempotencyKey = input.clientRequestId
    ? `storefront-order:${input.clientRequestId}`
    : null;
  if (idempotencyKey) {
    const { data: existing, error: existingError } = await supabase
      .from("idempotency_keys")
      .select("request_hash, response")
      .eq("organization_id", row.organization_id)
      .eq("key", idempotencyKey)
      .maybeSingle();
    if (existingError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, existingError.message);
    if (existing?.response) {
      return existing.response as { status: "SUBMITTED"; orderNumber: string | null };
    }
    if (existing) {
      throw new AppError(ERROR_CODES.CONFLICT, "This order is already being submitted.");
    }
    const requestHash = hashSecret(
      JSON.stringify({
        customerName: input.customerName.trim(),
        phone,
        line1: input.line1.trim(),
        line2: input.line2?.trim() || null,
        city: input.city.trim(),
        state: input.state.trim(),
        pincode: input.pincode.trim(),
        paymentPreference: input.paymentPreference ?? null,
        items: input.items ?? [],
      })
    );
    const { error: reservationError } = await supabase.from("idempotency_keys").insert({
      organization_id: row.organization_id,
      key: idempotencyKey,
      request_hash: requestHash,
    });
    if (reservationError) {
      if (reservationError.code === "23505") {
        throw new AppError(ERROR_CODES.CONFLICT, "This order is already being submitted.");
      }
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, reservationError.message);
    }
  }

  const cart = input.items ?? [];
  const lineItems = cart.length
    ? cart.map((item) => ({ productId: item.productId, quantity: item.quantity }))
    : [{ title: "WhatsApp order", quantity: 1, unitPrice: 0 }];

  type CatalogRow = {
    id: string;
    name: string;
    sku?: string | null;
    price?: number | string;
    active: boolean;
    store_visible?: boolean;
    prepaid_enabled?: boolean;
    cod_enabled?: boolean;
    cod_advance_percent?: number | string | null;
    return_available?: boolean;
    inventory_balances?: unknown;
  };

  let quote: ReturnType<typeof quoteCatalogPayment> | null = null;
  let returnSummary: { kind: "available" | "none" | "mixed"; label: string } = { kind: "none", label: "No Return" };
  const messageItems: Array<{
    name: string;
    sku: string | null;
    quantity: number;
    unitPrice: number;
    returnPolicy: string;
  }> = [];
  if (cart.length) {
    const { returnPolicyLabel, summarizeReturnPolicy } = await import("@/modules/products/return-policy");
    const catalog = await loadCatalogProducts(
      supabase,
      row.organization_id,
      cart.map((item) => item.productId)
    );
    const byId = new Map(catalog.map((product) => [String(product.id), product]));
    const lines = cart.map((item) => {
      const product = byId.get(item.productId) as CatalogRow | undefined;
      if (!product || !product.active || product.store_visible === false) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, "A product in your cart is no longer available.");
      }
      if (catalogOnHand(product) < item.quantity) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${product.name} is out of stock.`);
      }
      const unitPrice = Number(product.price ?? 0);
      const returnAvailable = product.return_available !== false;
      messageItems.push({
        name: product.name,
        sku: product.sku ?? null,
        quantity: item.quantity,
        unitPrice,
        returnPolicy: returnPolicyLabel(returnAvailable),
      });
      return {
        unitPrice,
        quantity: item.quantity,
        prepaidEnabled: product.prepaid_enabled !== false,
        codEnabled: product.cod_enabled !== false,
        codAdvancePercent: product.cod_advance_percent ?? 0,
        returnAvailable,
      };
    });
    if (input.paymentPreference === "PREPAID") {
      const blocked = catalog.find((product) => (product as CatalogRow).prepaid_enabled === false);
      if (blocked) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${(blocked as { name: string }).name} does not support prepaid.`);
      }
    }
    if (input.paymentPreference === "COD") {
      const blocked = catalog.find((product) => (product as CatalogRow).cod_enabled === false);
      if (blocked) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${(blocked as { name: string }).name} does not support COD.`);
      }
    }
    quote = quoteCatalogPayment({
      preference: input.paymentPreference === "COD" ? "COD" : "PREPAID",
      lines,
    });
    returnSummary = summarizeReturnPolicy(lines.map((line) => line.returnAvailable));
  }

  const paymentStatus = "PENDING";

  const orderInput = createOrderSchema.parse({
    source: "WHATSAPP",
    paymentStatus,
    customer: { name: input.customerName.trim(), phone },
    shippingAddress: {
      name: input.customerName.trim(),
      phone,
      line1: input.line1.trim(),
      line2: input.line2?.trim() || undefined,
      city: input.city.trim(),
      state: input.state.trim(),
      pincode: input.pincode.trim(),
      country: "IN",
    },
    billingSameAsShipping: true,
    lineItems,
    metadata: quote
      ? {
          storefront: {
            paymentPreference: quote.preference,
            expectedAdvance: quote.expectedAdvance,
            amountOnDelivery: quote.amountOnDelivery,
            total: quote.total,
            returnPolicy: returnSummary.label,
            items: messageItems,
          },
        }
      : undefined,
  });

  let order: Awaited<ReturnType<typeof createManualOrder>>;
  try {
    order = await createManualOrder(
      supabase,
      { organizationId: row.organization_id, userId: null },
      { ...orderInput, status: "IMPORTED" }
    );
  } catch (error) {
    if (idempotencyKey) {
      await supabase
        .from("idempotency_keys")
        .delete()
        .eq("organization_id", row.organization_id)
        .eq("key", idempotencyKey);
    }
    throw error;
  }

  await supabase.from("audit_logs").insert({
    organization_id: row.organization_id,
    actor_id: null,
    action: "customer_order_link.submitted",
    entity_type: "order",
    entity_id: order.id,
    after: { collectionLinkId: row.id, itemCount: cart.length },
  });

  const total = Number(quote?.total ?? order.totalAmount ?? order.total_amount ?? 0);
  const advanceAmount = quote?.preference === "COD" ? Number(quote.amountDueNow ?? 0) : 0;
  const codAmount = quote?.preference === "COD" ? Number(quote.amountOnDelivery ?? 0) : 0;
  const paymentMethod =
    quote?.preference === "COD"
      ? advanceAmount > 0
        ? "COD with advance"
        : "Cash on delivery"
      : "Prepaid";
  const result = {
    status: "SUBMITTED" as const,
    orderNumber: (() => {
      const stored = (order.orderNumber ?? order.order_number ?? null) as string | null;
      return stored ? formatWhatsAppOrderNumber(stored) || stored : null;
    })(),
    total,
    advanceAmount,
    codAmount,
    paymentMethod,
    returnPolicy: returnSummary.label,
  };
  if (idempotencyKey) {
    await supabase
      .from("idempotency_keys")
      .update({ response: result })
      .eq("organization_id", row.organization_id)
      .eq("key", idempotencyKey);
  }

  try {
    const { notifyStorefrontOrderCreated } = await import("@/modules/storefront/order-notify");
    const orderNumber = result.orderNumber || "Order";
    await notifyStorefrontOrderCreated(supabase, row.organization_id, order.id, {
      storeName: (await merchantName(supabase, row.organization_id)) || "Postbus",
      orderNumber,
      customerName: input.customerName.trim(),
      whatsapp: phone,
      line1: input.line1.trim(),
      line2: input.line2?.trim() || null,
      city: input.city.trim(),
      state: input.state.trim(),
      pincode: input.pincode.trim(),
      items: messageItems,
      total,
      advanceAmount,
      codAmount,
      paymentMethod,
      returnPolicy: returnSummary.label,
      status: "Awaiting Confirmation",
    });
  } catch {
    // WhatsApp delivery must not undo a created Postbus order.
  }

  return result;
}
