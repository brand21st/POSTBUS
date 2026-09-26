import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { orIlike } from "@/lib/api/filters";
import { getSystemHealth } from "@/lib/api/health";
import { canAssignMemberRole } from "@/lib/api/v1-permissions";
import {
  createApiKeySchema,
  createWebhookEndpointSchema,
  memberInviteSchema,
  updateOrganizationSchema,
} from "@/lib/api/v1-schemas";
import { isBillingConfiguredAsync } from "@/modules/razorpay/config";
import { encryptSecret, hashSecret, randomToken } from "@/lib/security/crypto";
import { getAutomationSettings, updateAutomationSettings } from "@/modules/automation/service";
import {
  mapOrganizationSettings,
  uploadOrganizationLogo,
  type OrganizationIdentityRow,
} from "@/modules/organizations/branding";
import { WEBHOOK_EVENTS } from "@/types/domain";

function uniqueById<T extends { id: string }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export async function handleWorkspaceRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  key: string,
  method: string,
  slugs: string[]
) {
  if (key === "GET organizations") {
    const { data } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", ctx.organizationId)
      .single();
    return data ? mapOrganizationSettings(data as OrganizationIdentityRow) : data;
  }

  if (key === "PATCH organizations") {
    const contentType = request.headers.get("content-type") ?? "";
    let body: ReturnType<typeof updateOrganizationSchema.parse>;
    let logo: File | null = null;
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("logo");
      logo = file instanceof File && file.size > 0 ? file : null;
      body = updateOrganizationSchema.parse({
        name: form.get("name") || undefined,
        phone: form.get("phone") ?? undefined,
        line1: form.get("line1") ?? undefined,
        line2: form.get("line2") ?? undefined,
        city: form.get("city") ?? undefined,
        state: form.get("state") ?? undefined,
        pincode: form.get("pincode") ?? undefined,
      });
    } else {
      body = updateOrganizationSchema.parse(await request.json().catch(() => ({})));
    }

    const updates: Record<string, string | null> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.phone !== undefined) updates.phone = body.phone ?? null;
    if (body.line1 !== undefined) updates.line1 = body.line1 ?? null;
    if (body.line2 !== undefined) updates.line2 = body.line2 ?? null;
    if (body.city !== undefined) updates.city = body.city ?? null;
    if (body.state !== undefined) updates.state = body.state ?? null;
    if (body.pincode !== undefined) updates.pincode = body.pincode ?? null;
    if (logo) {
      updates.logo_path = await uploadOrganizationLogo(supabase, ctx, logo);
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "No organization fields were provided.");
    }

    const { data, error } = await supabase
      .from("organizations")
      .update(updates)
      .eq("id", ctx.organizationId)
      .select()
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return mapOrganizationSettings(data as OrganizationIdentityRow);
  }

  if (key === "POST organizations/switch") {
    return { switched: true };
  }

  if (key === "GET automation") {
    return getAutomationSettings(supabase, ctx.organizationId);
  }

  if (key === "PATCH automation") {
    const body = await request.json().catch(() => ({}));
    return updateAutomationSettings(supabase, ctx, body);
  }

  if (key === "GET billing") {
    const { data: subscription } = await supabase
      .from("organization_subscriptions")
      .select("*, billing_plans(*)")
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    const { count } = await supabase
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organizationId)
      .eq("metric", "shipments");
    const { data: invoices } = await supabase
      .from("invoices")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false });
    const plan = subscription?.billing_plans as { code?: string; name?: string; shipment_limit?: number } | null;
    return {
      configurationRequired: !(await isBillingConfiguredAsync()),
      plan: plan ? { code: plan.code, name: plan.name, shipmentLimit: plan.shipment_limit } : { name: "Starter" },
      subscription: {
        status: subscription?.status ?? "CONFIGURATION_REQUIRED",
        billingCycleStart: subscription?.billing_cycle_start,
        billingCycleEnd: subscription?.billing_cycle_end,
      },
      usage: { metric: "shipments", quantity: count ?? 0, limit: plan?.shipment_limit ?? null },
      invoices: invoices ?? [],
    };
  }

  if (key === "GET notifications") {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false })
      .limit(30);
    return {
      items: (data ?? []).map((item) => ({
        ...item,
        entityId: item.entity_id,
        entityType: item.entity_type,
        readAt: item.read_at,
        createdAt: item.created_at,
        href:
          item.type === "labels.barcode_and_packing_ready"
            ? "/dashboard/labels"
            : item.entity_type === "order" && item.entity_id
              ? `/dashboard/orders/${item.entity_id}`
              : null,
      })),
    };
  }

  if (key === "GET members") {
    const { data: members } = await supabase
      .from("organization_members")
      .select("id, role, created_at, user_id")
      .eq("organization_id", ctx.organizationId);
    const userIds = (members ?? []).map((row) => row.user_id);
    const { data: profiles } = userIds.length
      ? await supabase.from("profiles").select("id, email, full_name").in("id", userIds)
      : { data: [] };
    const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    return {
      items: (members ?? []).map((row) => ({
        id: row.id,
        role: row.role,
        email: byId.get(row.user_id)?.email,
        fullName: byId.get(row.user_id)?.full_name,
        createdAt: row.created_at,
      })),
    };
  }

  if (key === "GET members/invites") {
    const { data } = await supabase
      .from("organization_invites")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .is("accepted_at", null);
    return { items: data ?? [] };
  }

  if (key === "POST members/invites") {
    const body = memberInviteSchema.parse(await request.json());
    if (!canAssignMemberRole(ctx.role, body.role)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "You cannot assign that workspace role.");
    }
    const token = randomToken(16);
    const { data, error } = await supabase
      .from("organization_invites")
      .insert({
        organization_id: ctx.organizationId,
        email: body.email,
        role: body.role,
        token_hash: hashSecret(token),
        invited_by: ctx.userId,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      })
      .select()
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return data;
  }

  if (key === "GET settings/notifications") {
    return { emailAlerts: true, inApp: true };
  }

  if (key === "PATCH settings/notifications") {
    return await request.json();
  }

  if (key === "GET api-keys") {
    const { data } = await supabase
      .from("api_keys")
      .select("id, name, key_prefix, status, last_used_at, created_at")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false });
    return { items: data ?? [] };
  }

  if (key === "POST api-keys") {
    const body = createApiKeySchema.parse(await request.json().catch(() => ({})));
    const secret = `pb_live_${randomToken(24)}`;
    const prefix = secret.slice(0, 12);
    const { data, error } = await supabase
      .from("api_keys")
      .insert({
        organization_id: ctx.organizationId,
        name: body.name || "Default",
        key_prefix: prefix,
        secret_hash: hashSecret(secret),
        created_by: ctx.userId,
      })
      .select("id, name, key_prefix, status, created_at")
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    await supabase.from("audit_logs").insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.userId,
      action: "api_key.created",
      entity_type: "api_key",
      entity_id: data.id,
    });
    return { ...data, secret };
  }

  if (method === "DELETE" && slugs[0] === "api-keys" && slugs[1]) {
    await supabase
      .from("api_keys")
      .update({ status: "REVOKED" })
      .eq("organization_id", ctx.organizationId)
      .eq("id", slugs[1]);
    await supabase.from("audit_logs").insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.userId,
      action: "api_key.revoked",
      entity_type: "api_key",
      entity_id: slugs[1],
    });
    return { revoked: true };
  }

  if (key === "GET webhooks") {
    const { data } = await supabase
      .from("webhook_endpoints")
      .select("id, url, events, is_active, created_at, updated_at, encrypted_secret")
      .eq("organization_id", ctx.organizationId);
    return {
      items: (data ?? []).map((item) => ({
        id: item.id,
        url: item.url,
        events: item.events,
        is_active: item.is_active,
        created_at: item.created_at,
        updated_at: item.updated_at,
        needsSecretRotation: !item.encrypted_secret,
      })),
    };
  }

  if (key === "POST webhooks") {
    const body = createWebhookEndpointSchema.parse(await request.json());
    const secret = randomToken(16);
    const { data, error } = await supabase
      .from("webhook_endpoints")
      .insert({
        organization_id: ctx.organizationId,
        url: body.url,
        secret_hash: hashSecret(secret),
        encrypted_secret: encryptSecret(secret),
        events: body.events ?? [...WEBHOOK_EVENTS],
      })
      .select("id, url, events, is_active, created_at, updated_at")
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return { ...data, secret, needsSecretRotation: false };
  }

  if (key === "GET audit-logs") {
    const { data } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false })
      .limit(100);
    return { items: data ?? [] };
  }

  if (key === "GET search") {
    const q = (request.nextUrl.searchParams.get("q") || "").trim();
    if (q.length < 2) return { items: [] };
    const orderFilter = orIlike(["order_number", "source_order_id"], q);
    const shipmentFilter = orIlike(["barcode", "tracking_number"], q);
    const customerFilter = orIlike(["name", "phone", "email"], q);
    if (!orderFilter && !shipmentFilter && !customerFilter) return { items: [] };

    const [orderResult, shipmentResult, customerResult] = await Promise.all([
      orderFilter
        ? supabase
            .from("orders")
            .select("id, order_number, source_order_id, customer_id, customers(name, phone)")
            .eq("organization_id", ctx.organizationId)
            .or(orderFilter)
            .limit(8)
        : Promise.resolve({ data: [], error: null }),
      shipmentFilter
        ? supabase
            .from("shipments")
            .select("id, barcode, tracking_number, order_id, orders(order_number)")
            .eq("organization_id", ctx.organizationId)
            .or(shipmentFilter)
            .limit(8)
        : Promise.resolve({ data: [], error: null }),
      customerFilter
        ? supabase
            .from("customers")
            .select("id, name, phone, email")
            .eq("organization_id", ctx.organizationId)
            .or(customerFilter)
            .limit(8)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const queryError = orderResult.error || shipmentResult.error || customerResult.error;
    if (queryError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, queryError.message);

    const customers = customerResult.data ?? [];
    const customerIds = customers.map((item) => item.id);
    const extraOrders =
      customerIds.length > 0
        ? await supabase
            .from("orders")
            .select("id, order_number, source_order_id, customer_id, customers(name, phone)")
            .eq("organization_id", ctx.organizationId)
            .in("customer_id", customerIds)
            .order("created_at", { ascending: false })
            .limit(8)
        : { data: [], error: null };
    if (extraOrders.error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, extraOrders.error.message);

    const orderIds = [...(orderResult.data ?? []), ...(extraOrders.data ?? [])].map((item) => item.id);
    const extraShipments =
      orderIds.length > 0
        ? await supabase
            .from("shipments")
            .select("id, barcode, tracking_number, order_id, orders(order_number)")
            .eq("organization_id", ctx.organizationId)
            .in("order_id", orderIds)
            .limit(8)
        : { data: [], error: null };
    if (extraShipments.error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, extraShipments.error.message);

    const orders = uniqueById([...(orderResult.data ?? []), ...(extraOrders.data ?? [])]);
    const shipments = uniqueById([...(shipmentResult.data ?? []), ...(extraShipments.data ?? [])]);

    return {
      items: [
        ...orders.map((item) => {
          const customer = Array.isArray(item.customers) ? item.customers[0] : item.customers;
          return {
            id: item.id,
            type: "order",
            title: item.order_number,
            subtitle: [customer?.name, customer?.phone, item.source_order_id !== item.order_number ? item.source_order_id : null]
              .filter(Boolean)
              .join(" · "),
            href: `/dashboard/orders/${item.id}`,
          };
        }),
        ...shipments.map((item) => {
          const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
          return {
            id: item.id,
            type: "shipment",
            title: item.barcode || item.tracking_number,
            subtitle: order?.order_number,
            href: `/dashboard/shipments/${item.id}`,
          };
        }),
        ...customers.map((item) => ({
          id: item.id,
          type: "customer",
          title: item.name,
          subtitle: [item.phone, item.email].filter(Boolean).join(" · "),
          href: `/dashboard/orders?q=${encodeURIComponent(item.phone || item.name)}`,
        })),
      ],
    };
  }

  if (key === "GET health") {
    return getSystemHealth(supabase);
  }

  return null;
}
