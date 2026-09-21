import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { ilikePattern, orIlike } from "@/lib/api/filters";
import { getSystemHealth } from "@/lib/api/health";
import { canAssignMemberRole } from "@/lib/api/v1-permissions";
import {
  createApiKeySchema,
  createWebhookEndpointSchema,
  memberInviteSchema,
  updateOrganizationSchema,
} from "@/lib/api/v1-schemas";
import { isBillingConfigured } from "@/lib/env";
import { encryptSecret, hashSecret, randomToken } from "@/lib/security/crypto";
import { getAutomationSettings, updateAutomationSettings } from "@/modules/automation/service";
import { WEBHOOK_EVENTS } from "@/types/domain";

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
    return data;
  }

  if (key === "PATCH organizations") {
    const body = updateOrganizationSchema.parse(await request.json());
    const { data, error } = await supabase
      .from("organizations")
      .update({
        name: body.name,
        timezone: body.timezone,
        currency: body.currency,
      })
      .eq("id", ctx.organizationId)
      .select()
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return data;
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
      configurationRequired: !isBillingConfigured(),
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
          item.entity_type === "order" && item.entity_id
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
    const q = request.nextUrl.searchParams.get("q") || "";
    if (q.length < 2) return { items: [] };
    const orderPattern = ilikePattern(q);
    const shipmentFilter = orIlike(["barcode", "tracking_number"], q);
    const customerPattern = ilikePattern(q);
    if (!orderPattern && !shipmentFilter && !customerPattern) return { items: [] };
    const [{ data: orders }, { data: shipments }, { data: customers }] = await Promise.all([
      orderPattern
        ? supabase
            .from("orders")
            .select("id, order_number")
            .eq("organization_id", ctx.organizationId)
            .ilike("order_number", orderPattern)
            .limit(5)
        : Promise.resolve({ data: [] }),
      shipmentFilter
        ? supabase
            .from("shipments")
            .select("id, barcode, tracking_number")
            .eq("organization_id", ctx.organizationId)
            .or(shipmentFilter)
            .limit(5)
        : Promise.resolve({ data: [] }),
      customerPattern
        ? supabase
            .from("customers")
            .select("id, name, phone")
            .eq("organization_id", ctx.organizationId)
            .ilike("name", customerPattern)
            .limit(5)
        : Promise.resolve({ data: [] }),
    ]);
    return {
      items: [
        ...(orders ?? []).map((item) => ({
          id: item.id,
          type: "order",
          title: item.order_number,
          href: `/dashboard/orders/${item.id}`,
        })),
        ...(shipments ?? []).map((item) => ({
          id: item.id,
          type: "shipment",
          title: item.barcode || item.tracking_number,
          href: `/dashboard/shipments/${item.id}`,
        })),
        ...(customers ?? []).map((item) => ({
          id: item.id,
          type: "customer",
          title: item.name,
          subtitle: item.phone,
          href: `/dashboard/orders?q=${encodeURIComponent(item.name)}`,
        })),
      ],
    };
  }

  if (key === "GET health") {
    return getSystemHealth(supabase);
  }

  return null;
}
