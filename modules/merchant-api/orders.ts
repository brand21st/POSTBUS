import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { MerchantApiKeyContext } from "@/modules/merchant-api/auth";
import { decodeCursor, encodeCursor, publicOrderDto } from "@/modules/merchant-api/dto";
import { MerchantApiError, MERCHANT_ERROR_CODES } from "@/modules/merchant-api/errors";
import {
  merchantCreateOrderSchema,
  merchantOrderListQuery,
  merchantPatchOrderSchema,
  toAddressInput,
  toCreateOrderInput,
  toWeightInput,
} from "@/modules/merchant-api/schema";
import { createManualOrder, getOrder, setOrderBookingService, updateOrderShippingAddress, updateOrderWeights } from "@/modules/orders/service";

function actor(ctx: MerchantApiKeyContext): TenantContext {
  return {
    userId: ctx.createdBy ?? "",
    email: null,
    fullName: null,
    organizationId: ctx.organizationId,
    organizationName: ctx.organizationName,
    role: "OPERATOR",
    permissions: [],
  };
}

async function loadExternalId(supabase: SupabaseClient, organizationId: string, orderId: string) {
  const { data } = await supabase
    .from("external_order_references")
    .select("source_order_id")
    .eq("organization_id", organizationId)
    .eq("order_id", orderId)
    .eq("source", "API")
    .maybeSingle();
  return (data?.source_order_id as string | undefined) ?? null;
}

export async function findOrderByExternalId(
  supabase: SupabaseClient,
  organizationId: string,
  externalOrderId: string
) {
  const { data } = await supabase
    .from("external_order_references")
    .select("order_id")
    .eq("organization_id", organizationId)
    .eq("source", "API")
    .eq("source_order_id", externalOrderId)
    .maybeSingle();
  return (data?.order_id as string | undefined) ?? null;
}

export async function createMerchantOrder(
  supabase: SupabaseClient,
  ctx: MerchantApiKeyContext,
  raw: unknown
) {
  const body = merchantCreateOrderSchema.parse(raw);
  if (body.external_order_id) {
    const existingId = await findOrderByExternalId(supabase, ctx.organizationId, body.external_order_id);
    if (existingId) {
      const existing = await getOrder(supabase, actor(ctx), existingId);
      return { duplicate: true, order: publicOrderDto(existing as Record<string, unknown>, body.external_order_id) };
    }
  }

  const input = toCreateOrderInput(body);
  const created = await createManualOrder(supabase, actor(ctx), input);
  if (body.india_post_service) {
    await setOrderBookingService(supabase, actor(ctx), created.id, body.india_post_service);
  }

  if (body.external_order_id) {
    const { error } = await supabase.from("external_order_references").insert({
      organization_id: ctx.organizationId,
      order_id: created.id,
      source: "API",
      source_order_id: body.external_order_id,
    });
    if (error?.code === "23505") {
      const existingId = await findOrderByExternalId(supabase, ctx.organizationId, body.external_order_id);
      if (existingId) {
        const existing = await getOrder(supabase, actor(ctx), existingId);
        return { duplicate: true, order: publicOrderDto(existing as Record<string, unknown>, body.external_order_id) };
      }
    } else if (error) {
      throw new MerchantApiError(MERCHANT_ERROR_CODES.VALIDATION_ERROR, "Unable to store the external order reference.");
    }
    await supabase
      .from("orders")
      .update({ source_order_id: body.external_order_id, source: "API" })
      .eq("id", created.id)
      .eq("organization_id", ctx.organizationId);
  }

  const order = await getOrder(supabase, actor(ctx), created.id);
  try {
    const { publishOrderCreated } = await import("@/modules/webhooks/publish");
    await publishOrderCreated(supabase, {
      organizationId: ctx.organizationId,
      orderId: created.id,
      orderNumber: created.order_number as string | undefined,
      externalOrderId: body.external_order_id ?? null,
      status: (created.status as string | undefined) ?? "READY",
    });
  } catch {
    // Webhook fan-out must not break Merchant API order creation.
  }
  return { duplicate: false, order: publicOrderDto(order as Record<string, unknown>, body.external_order_id ?? null) };
}

export async function getMerchantOrder(supabase: SupabaseClient, ctx: MerchantApiKeyContext, orderId: string) {
  const order = await getOrder(supabase, actor(ctx), orderId);
  const externalId = await loadExternalId(supabase, ctx.organizationId, orderId);
  return publicOrderDto(order as Record<string, unknown>, externalId);
}

export async function listMerchantOrders(
  supabase: SupabaseClient,
  ctx: MerchantApiKeyContext,
  search: URLSearchParams
) {
  const query = merchantOrderListQuery.parse({
    updated_since: search.get("updated_since") ?? undefined,
    status: search.get("status") ?? undefined,
    limit: search.get("limit") ?? undefined,
    cursor: search.get("cursor") ?? undefined,
  });
  const cursor = decodeCursor(query.cursor);
  let builder = supabase
    .from("orders")
    .select(
      "*, customers(*), shipping_address:addresses!shipping_address_id(*), billing_address:addresses!billing_address_id(*), order_line_items(*), shipments(id, status, barcode, tracking_number)"
    )
    .eq("organization_id", ctx.organizationId)
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(query.limit + 1);

  if (query.status) builder = builder.eq("status", query.status);
  if (query.updated_since) builder = builder.gte("updated_at", query.updated_since);
  if (cursor) {
    builder = builder.or(`updated_at.gt.${cursor.u},and(updated_at.eq.${cursor.u},id.gt.${cursor.i})`);
  }

  const { data, error } = await builder;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to list orders.");
  const rows = data ?? [];
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1] as { updated_at?: string; id?: string } | undefined;
  const ids = page.map((row) => String(row.id));
  const refs = ids.length
    ? await supabase
        .from("external_order_references")
        .select("order_id, source_order_id")
        .eq("organization_id", ctx.organizationId)
        .eq("source", "API")
        .in("order_id", ids)
    : { data: [] as Array<{ order_id: string; source_order_id: string }> };
  const byOrder = new Map(
    (refs.data ?? []).map((row) => [String(row.order_id), String(row.source_order_id)])
  );
  const items = page.map((row) =>
    publicOrderDto(
      row as Record<string, unknown>,
      byOrder.get(String(row.id)) ?? (row.source_order_id as string | null)
    )
  );
  return {
    items,
    next_cursor: hasMore && last?.updated_at && last.id ? encodeCursor(String(last.updated_at), String(last.id)) : null,
  };
}

export async function patchMerchantOrder(
  supabase: SupabaseClient,
  ctx: MerchantApiKeyContext,
  orderId: string,
  raw: unknown
) {
  const body = merchantPatchOrderSchema.parse(raw);
  const tenant = actor(ctx);
  if (body.shipping_address) {
    await updateOrderShippingAddress(supabase, tenant, orderId, toAddressInput(body.shipping_address));
  }
  if (body.line_items?.length && body.parcel_weight_mode) {
    await updateOrderWeights(supabase, tenant, orderId, toWeightInput(body));
  } else if (body.parcel_weight_mode || body.line_items) {
    throw new MerchantApiError(
      MERCHANT_ERROR_CODES.VALIDATION_ERROR,
      "Weight updates require parcel_weight_mode and line_items."
    );
  }
  return getMerchantOrder(supabase, ctx, orderId);
}

export { actor as merchantActor };
