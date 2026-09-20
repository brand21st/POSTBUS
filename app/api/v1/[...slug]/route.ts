import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/response";
import { createRequestId, logError, logInfo } from "@/lib/logger";
import { createServerSupabase } from "@/lib/supabase/server";
import { env, isBillingConfigured, isShopifyAppConfigured } from "@/lib/env";
import { rateLimit } from "@/lib/security/rate-limit";
import { encryptSecret, hashSecret, maskSecret, randomToken } from "@/lib/security/crypto";
import { createOrganization, listMemberships, switchOrganization } from "@/modules/organizations/service";
import { createOrderSchema, orderListQuery } from "@/modules/orders/schema";
import { createManualOrder, exportOrdersCsv, getOrder, listOrders } from "@/modules/orders/service";
import { createShipmentsForOrders, getShipment, listShipments, retryShipment } from "@/modules/shipments/service";
import { getKpis, getPipeline } from "@/modules/dashboard/service";
import { createBackgroundJob } from "@/modules/jobs/service";
import { getAutomationSettings, updateAutomationSettings } from "@/modules/automation/service";
import { hasPermission } from "@/lib/permissions/rbac";
import {
  exchangeShopifyToken,
  newOAuthState,
  normalizeShopDomain,
  hasStoredClientSecret,
  resolveShopifyAppCredentials,
  resolveShopifyWebhookSecrets,
  shopifyAppConfiguredFor,
  shopifyInstallUrl,
  shopifyWebhookUrl,
  storedClientId,
  verifyShopifyHmac,
} from "@/modules/shopify/oauth";
import {
  importShopifyWebhookOrder,
  shopifyReadyToSync,
  syncUnfulfilledShopifyOrders,
  type ShopifyRemoteOrder,
} from "@/modules/shopify/orders";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { indiaPostWebhookUrls, parseIndiaPostWebhookPath } from "@/modules/india-post/webhook-urls";
import { WEBHOOK_EVENTS } from "@/types/domain";
import JSZip from "jszip";

async function handle(request: NextRequest, slugs: string[]) {
  const path = slugs.join("/");
  const method = request.method;
  const key = `${method} ${path}`;
  const indiaPostWebhook = parseIndiaPostWebhookPath(path);
  const limited = rateLimit(
    `${request.headers.get("x-forwarded-for") ?? "local"}:${path}`,
    indiaPostWebhook ? 180 : 60
  );
  if (!limited.ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again shortly.");
  }

  if (indiaPostWebhook && method === "POST") {
    const raw = await request.text();
    const { createWebhookInboxClient } = await import("@/lib/supabase/admin");
    const { acceptIndiaPostWebhook } = await import("@/modules/india-post/webhook");
    return acceptIndiaPostWebhook(createWebhookInboxClient(), {
      connectionId: indiaPostWebhook.connectionId,
      channel: indiaPostWebhook.channel,
      rawBody: raw,
      contentType: request.headers.get("content-type"),
      headers: request.headers,
    });
  }

  if (path === "webhooks/shopify" && method === "POST") {
    const { verifyWebhookHmac } = await import("@/modules/shopify/oauth");
    const raw = await request.text();
    const topic = request.headers.get("x-shopify-topic") || "";
    const shop = request.headers.get("x-shopify-shop-domain") || "";
    const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
    const eventId = request.headers.get("x-shopify-webhook-id") || hashSecret(raw);
    const { createAdminClient, hasAdminClient } = await import("@/lib/supabase/admin");
    const admin = hasAdminClient() ? createAdminClient() : null;
    const { data: connection } = admin
      ? await admin
          .from("shopify_connections")
          .select(
            "organization_id, client_id, encrypted_client_secret, encrypted_previous_client_secret, encrypted_api_key, encrypted_api_secret"
          )
          .eq("shop_domain", shop)
          .maybeSingle()
      : { data: null };
    const webhookSecrets = resolveShopifyWebhookSecrets(connection);
    if (!verifyWebhookHmac(raw, hmacHeader, webhookSecrets)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "Invalid Shopify webhook signature.");
    }
    if (!admin) {
      return { accepted: true, queued: false };
    }
    const { data: existing } = await admin
      .from("idempotency_keys")
      .select("id")
      .eq("key", `shopify:${eventId}`)
      .maybeSingle();
    if (existing) return { duplicate: true };
    if (connection) {
      await admin.from("idempotency_keys").insert({
        organization_id: connection.organization_id,
        key: `shopify:${eventId}`,
        request_hash: hashSecret(raw),
      });
      if (topic === "app/uninstalled") {
        await admin
          .from("shopify_connections")
          .update({ status: "DISCONNECTED", encrypted_access_token: null })
          .eq("organization_id", connection.organization_id);
      } else if (topic.startsWith("orders/")) {
        try {
          const remote = JSON.parse(raw) as ShopifyRemoteOrder;
          await importShopifyWebhookOrder(admin, {
            organizationId: connection.organization_id,
            shopDomain: shop,
            topic,
            remote,
          });
        } catch (error) {
          logError("shopify.webhook_order_import_failed", {
            topic,
            shop,
            message: error instanceof Error ? error.message : "import failed",
          });
          throw error;
        }
      } else {
        await createBackgroundJob(admin, {
          organizationId: connection.organization_id,
          jobType: "shopify-sync",
          entityType: "shopify_connection",
          progress: { topic },
        });
      }
    }
    return { accepted: true };
  }

  const supabase = await createServerSupabase();

  if (key === "GET me") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Please sign in to continue.");
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    const memberships = await listMemberships(supabase, user.id);
    let organization = null;
    let role = null;
    if (profile?.active_organization_id) {
      const current = memberships.find((item) => item.organization_id === profile.active_organization_id);
      const org = Array.isArray(current?.organizations) ? current?.organizations[0] : current?.organizations;
      organization = org ? { id: org.id, name: org.name, slug: org.slug } : null;
      role = current?.role ?? null;
    }
    const { data: subscription } = organization
      ? await supabase
          .from("organization_subscriptions")
          .select("status, billing_plans(code, name)")
          .eq("organization_id", organization.id)
          .maybeSingle()
      : { data: null };
    const plan = subscription?.billing_plans as { code?: string; name?: string } | null;
    return {
      user: {
        id: user.id,
        email: profile?.email ?? user.email,
        fullName: profile?.full_name,
        avatarUrl: profile?.avatar_url,
        whatsappNumber: profile?.whatsapp_number ?? null,
      },
      organization,
      role,
      organizations: memberships.map((item) => {
        const org = Array.isArray(item.organizations) ? item.organizations[0] : item.organizations;
        return { id: org?.id, name: org?.name, slug: org?.slug, role: item.role };
      }),
      subscription: {
        planCode: plan?.code,
        planName: plan?.name,
        status: subscription?.status ?? "CONFIGURATION_REQUIRED",
      },
    };
  }

  if (key === "POST organizations") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Please sign in to continue.");
    const body = await request.json().catch(() => ({}));
    const name = z.string().min(2).parse(body.name);
    return createOrganization(supabase, user.id, name);
  }

  const ctx = await requireTenant();

  if (key === "GET organizations") {
    const { data } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", ctx.organizationId)
      .single();
    return data;
  }

  if (key === "PATCH organizations") {
    const body = await request.json();
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
    const body = await request.json();
    await switchOrganization(supabase, ctx.userId, body.organizationId);
    return { switched: true };
  }

  if (key === "GET dashboard/kpis") {
    const from = request.nextUrl.searchParams.get("from") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = request.nextUrl.searchParams.get("to") || new Date().toISOString().slice(0, 10);
    return getKpis(supabase, ctx, from, to);
  }

  if (key === "GET dashboard/pipeline") {
    const from = request.nextUrl.searchParams.get("from") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = request.nextUrl.searchParams.get("to") || new Date().toISOString().slice(0, 10);
    return getPipeline(supabase, ctx, from, to);
  }

  if (key === "GET orders") {
    const parsed = orderListQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    return listOrders(supabase, ctx, parsed);
  }

  if (key === "GET orders/export") {
    const csv = await exportOrdersCsv(supabase, ctx);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=orders.csv",
      },
    });
  }

  if (method === "GET" && slugs[0] === "orders" && slugs[1]) {
    return getOrder(supabase, ctx, slugs[1]);
  }

  if (key === "POST orders") {
    const body = createOrderSchema.parse(await request.json());
    const order = await createManualOrder(supabase, ctx, body);
    if (body.createShipment) {
      await createShipmentsForOrders(supabase, ctx, [order.id], body.shipment);
    }
    return order;
  }

  if (key === "GET shipments") {
    return listShipments(supabase, ctx, {
      page: Number(request.nextUrl.searchParams.get("page") || 1),
      pageSize: Number(request.nextUrl.searchParams.get("pageSize") || 20),
      q: request.nextUrl.searchParams.get("q") || undefined,
      status: request.nextUrl.searchParams.get("status") || undefined,
      orderId: request.nextUrl.searchParams.get("orderId") || undefined,
    });
  }

  if (key === "POST shipments") {
    const body = await request.json();
    const orderIds: string[] = body.orderIds ?? (body.orderId ? [body.orderId] : []);
    return createShipmentsForOrders(supabase, ctx, orderIds, body);
  }

  if (method === "GET" && slugs[0] === "shipments" && slugs[1] && !slugs[2]) {
    return getShipment(supabase, ctx, slugs[1]);
  }

  if (method === "POST" && slugs[0] === "shipments" && slugs[2] === "retry") {
    return retryShipment(supabase, ctx, slugs[1]);
  }

  if (key === "GET labels") {
    const page = Number(request.nextUrl.searchParams.get("page") || 1);
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") || 20);
    const from = (page - 1) * pageSize;
    const { data, count, error } = await supabase
      .from("labels")
      .select("*, shipments(barcode, tracking_number, orders(order_number))", { count: "exact" })
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return {
      items: data ?? [],
      page,
      pageSize,
      total: count ?? 0,
    };
  }

  if (method === "GET" && slugs[0] === "labels" && slugs[2] === "download") {
    const { data } = await supabase
      .from("labels")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .eq("id", slugs[1])
      .single();
    if (!data?.file_path) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Label file not found.");
    const signed = await supabase.storage.from("labels").createSignedUrl(data.file_path, 120);
    return NextResponse.redirect(signed.data?.signedUrl || "/dashboard/labels");
  }

  if (key === "POST labels/bulk-download") {
    const body = await request.json();
    const ids: string[] = body.ids ?? [];
    const { data } = await supabase
      .from("labels")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .in("id", ids);
    const zip = new JSZip();
    for (const label of data ?? []) {
      if (!label.file_path) continue;
      const file = await supabase.storage.from("labels").download(label.file_path);
      if (file.data) zip.file(`${label.id}.pdf`, await file.data.arrayBuffer());
    }
    const bytes = await zip.generateAsync({ type: "uint8array" });
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": "application/zip" },
    });
  }

  if (key === "GET manifests") {
    const page = Number(request.nextUrl.searchParams.get("page") || 1);
    const pageSize = 20;
    const from = (page - 1) * pageSize;
    const { data, count } = await supabase
      .from("manifests")
      .select("*", { count: "exact" })
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    return { items: data ?? [], page, pageSize, total: count ?? 0 };
  }

  if (key === "POST manifests") {
    const job = await createBackgroundJob(supabase, {
      organizationId: ctx.organizationId,
      jobType: "manifest-generation",
      entityType: "organization",
      entityId: ctx.organizationId,
      userId: ctx.userId,
    });
    return { queued: true, jobId: job.id };
  }

  if (key === "GET tracking") {
    const q = request.nextUrl.searchParams.get("q");
    let builder = supabase
      .from("shipments")
      .select("*, orders(order_number), tracking_events(*)")
      .eq("organization_id", ctx.organizationId)
      .not("barcode", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (q) builder = builder.or(`barcode.ilike.%${q}%,tracking_number.ilike.%${q}%`);
    const { data } = await builder;
    return {
      items: (data ?? []).map((row) => ({
        ...row,
        orderNumber: (row.orders as { order_number?: string } | null)?.order_number,
        events: row.tracking_events ?? [],
      })),
    };
  }

  if (key === "GET automation") {
    return getAutomationSettings(supabase, ctx.organizationId);
  }

  if (key === "PATCH automation") {
    if (!hasPermission(ctx.role, "automation.manage")) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "You do not have permission to change automation.");
    }
    const body = await request.json().catch(() => ({}));
    return updateAutomationSettings(supabase, ctx, body);
  }

  if (key === "GET integrations") {
    const [{ data: shopify }, { data: indiaPost }] = await Promise.all([
      supabase.from("shopify_connections").select("*").eq("organization_id", ctx.organizationId).maybeSingle(),
      supabase.from("india_post_connections").select("*").eq("organization_id", ctx.organizationId).maybeSingle(),
    ]);
    const shopifyConfigured = shopifyAppConfiguredFor(shopify);
    const shopifySyncReady = shopifyReadyToSync(shopify);
    return {
      shopify: {
        provider: "shopify",
        status: shopifyConfigured ? shopify?.status ?? "NOT_CONNECTED" : "NOT_CONNECTED",
        shopDomain: shopify?.shop_domain ?? "",
        lastSyncAt: shopify?.last_sync_at,
        lastError: shopify?.last_error,
        appConfigured: shopifyConfigured,
        readyToSync: shopifySyncReady,
      },
      indiaPost: {
        provider: "india_post",
        status: indiaPost?.status ?? "NOT_CONNECTED",
        lastVerifiedAt: indiaPost?.last_verified_at,
        lastError: indiaPost?.last_error,
      },
      items: [
        {
          provider: "shopify",
          name: "Shopify",
          status: shopifyConfigured ? shopify?.status ?? "NOT_CONNECTED" : "NOT_CONNECTED",
          appConfigured: shopifyConfigured,
          readyToSync: shopifySyncReady,
        },
        {
          provider: "india_post",
          name: "India Post",
          status: indiaPost?.status ?? "NOT_CONNECTED",
        },
        { provider: "woocommerce", name: "WooCommerce", status: "NOT_CONNECTED", comingLater: true },
        { provider: "vachat", name: "Vachat", status: "NOT_CONNECTED", comingLater: true },
        { provider: "whatsapp", name: "WhatsApp", status: "NOT_CONNECTED", comingLater: true },
      ],
    };
  }

  if (key === "GET integrations/shopify") {
    const { data } = await supabase
      .from("shopify_connections")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    const creds = resolveShopifyAppCredentials(data);
    const clientId = storedClientId(data);
    const hasSecret = hasStoredClientSecret(data);
    return {
      status: data?.status ?? "NOT_CONNECTED",
      shopDomain: data?.shop_domain ?? "",
      clientId,
      hasClientSecret: hasSecret,
      apiKeyMasked: clientId ? maskSecret(clientId) : "",
      hasApiKey: Boolean(clientId),
      hasApiSecret: hasSecret,
      requestedScopes: data?.requested_scopes || env.shopifyScopes,
      webhookUrl: shopifyWebhookUrl(),
      appConfigured: Boolean(creds),
      readyToSync: shopifyReadyToSync(data),
      lastSyncAt: data?.last_sync_at,
      lastError: data?.last_error,
    };
  }

  if (key === "POST integrations/shopify" || key === "PUT integrations/shopify" || key === "PATCH integrations/shopify") {
    const body = await request.json();
    const shopDomain = normalizeShopDomain(String(body.shopDomain ?? body.shop_domain ?? ""));
    if (!shopDomain) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Provide a shop domain.");
    }
    const { data: existing } = await supabase
      .from("shopify_connections")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    const clientId = String(body.clientId ?? body.client_id ?? body.apiKey ?? storedClientId(existing) ?? "").trim();
    if (!clientId) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Provide the Shopify Client ID.");
    }
    const incomingSecret = String(body.clientSecret ?? body.client_secret ?? body.apiSecret ?? "").trim();
    if (!hasStoredClientSecret(existing) && !incomingSecret) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Provide the Shopify Client secret.");
    }
    const payload: Record<string, unknown> = {
      organization_id: ctx.organizationId,
      shop_domain: shopDomain,
      client_id: clientId,
      requested_scopes: body.requestedScopes ?? body.requested_scopes ?? existing?.requested_scopes ?? env.shopifyScopes,
      status: existing?.status ?? "NOT_CONNECTED",
    };
    if (incomingSecret) {
      const currentSecret = existing?.encrypted_client_secret || existing?.encrypted_api_secret;
      if (currentSecret) payload.encrypted_previous_client_secret = currentSecret;
      payload.encrypted_client_secret = encryptSecret(incomingSecret);
    }

    const query = existing
      ? supabase.from("shopify_connections").update(payload).eq("id", existing.id)
      : supabase.from("shopify_connections").insert(payload);
    const { data, error } = await query.select().single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    await supabase.from("audit_logs").insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.userId,
      action: "shopify.credentials_saved",
      entity_type: "shopify_connection",
      entity_id: data.id,
    });
    const creds = resolveShopifyAppCredentials(data);
    const savedClientId = storedClientId(data);
    const hasSecret = hasStoredClientSecret(data);
    if (shopifyReadyToSync(data)) {
      void syncUnfulfilledShopifyOrders(supabase, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
      }).catch((error) => {
        logError("shopify.sync_after_save_failed", {
          message: error instanceof Error ? error.message : "sync failed",
        });
      });
    }
    return {
      saved: true,
      status: data.status,
      shopDomain: data.shop_domain,
      clientId: savedClientId,
      hasClientSecret: hasSecret,
      hasApiKey: Boolean(savedClientId),
      hasApiSecret: hasSecret,
      requestedScopes: data.requested_scopes || env.shopifyScopes,
      webhookUrl: shopifyWebhookUrl(),
      appConfigured: Boolean(creds),
    };
  }

  if (key === "GET integrations/shopify/connect") {
    const failRedirect = (message: string) =>
      NextResponse.redirect(
        `${env.appUrl}/dashboard/integrations/shopify?error=${encodeURIComponent(message)}`
      );
    const { data: connection } = await supabase
      .from("shopify_connections")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    const creds = resolveShopifyAppCredentials(connection);
    if (!creds) {
      return failRedirect("Save your Shopify Client ID and Client secret before connecting.");
    }
    const shop = request.nextUrl.searchParams.get("shop") || connection?.shop_domain;
    if (!shop) {
      return failRedirect("Provide a shop domain before connecting.");
    }
    const state = `${ctx.organizationId}.${newOAuthState()}`;
    return NextResponse.redirect(shopifyInstallUrl(shop, state, creds));
  }

  if (key === "GET integrations/shopify/callback") {
    const failRedirect = (message: string) =>
      NextResponse.redirect(
        `${env.appUrl}/dashboard/integrations/shopify?error=${encodeURIComponent(message)}`
      );
    const params = request.nextUrl.searchParams;
    if (params.get("error")) {
      return failRedirect(params.get("error_description") || params.get("error") || "Shopify denied access.");
    }
    const { data: connection } = await supabase
      .from("shopify_connections")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    const creds = resolveShopifyAppCredentials(connection);
    if (!creds) {
      return failRedirect("Save your Shopify Client ID and Client secret before connecting.");
    }
    if (!verifyShopifyHmac(params, creds.clientSecret)) {
      return failRedirect("Invalid Shopify HMAC. Check that the Client secret matches the app.");
    }
    const shop = normalizeShopDomain(params.get("shop") || "");
    const code = params.get("code");
    if (!shop || !code) {
      return failRedirect("Shopify did not return a shop or authorization code.");
    }
    try {
      const tokens = await exchangeShopifyToken(shop, code, creds);
      const record = {
        organization_id: ctx.organizationId,
        shop_domain: shop,
        encrypted_access_token: encryptSecret(tokens.access_token),
        scopes: tokens.scope,
        status: "CONNECTED",
        installed_at: new Date().toISOString(),
        last_error: null,
      };
      const { error } = connection
        ? await supabase.from("shopify_connections").update(record).eq("id", connection.id)
        : await supabase.from("shopify_connections").insert(record);
      if (error) return failRedirect(error.message);
      void syncUnfulfilledShopifyOrders(supabase, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
      }).catch((syncError) => {
        logError("shopify.sync_after_connect_failed", {
          message: syncError instanceof Error ? syncError.message : "sync failed",
        });
      });
      return NextResponse.redirect(`${env.appUrl}/dashboard/integrations/shopify`);
    } catch (error) {
      return failRedirect(error instanceof Error ? error.message : "Shopify token exchange failed.");
    }
  }

  if (key === "POST integrations/shopify/sync") {
    const { data: connection } = await supabase
      .from("shopify_connections")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (!shopifyReadyToSync(connection) && connection?.status !== "CONNECTED") {
      throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Shopify is not connected.");
    }
    const result = await syncUnfulfilledShopifyOrders(supabase, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    });
    if (!result.connected) {
      throw new AppError(
        ERROR_CODES.INTEGRATION_NOT_CONNECTED,
        "Could not authenticate with Shopify. Check Client ID and Client secret."
      );
    }
    return result;
  }

  if (key === "GET integrations/india-post") {
    const { data } = await supabase
      .from("india_post_connections")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    const { data: range } = await supabase
      .from("barcode_ranges")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .eq("is_active", true)
      .maybeSingle();
    return {
      environment: data?.environment ?? "UAT",
      status: data?.status ?? "NOT_CONNECTED",
      bulkCustomerId: data?.bulk_customer_id,
      contractId: data?.contract_id,
      pickupDropoffOfficeId: data?.pickup_dropoff_office_id,
      usernameMasked: data?.encrypted_username ? maskSecret("user") : "",
      hasPassword: Boolean(data?.encrypted_password),
      lastVerifiedAt: data?.last_verified_at,
      lastError: data?.last_error,
      ...(data?.id ? indiaPostWebhookUrls(data.id) : {}),
      barcodeRange: range
        ? {
            prefix: range.prefix,
            suffix: range.suffix,
            startNumber: range.start_number,
            endNumber: range.end_number,
            nextNumber: range.next_number,
          }
        : null,
    };
  }

  if (key === "PUT integrations/india-post" || key === "POST integrations/india-post" || key === "PATCH integrations/india-post") {
    const body = await request.json();
    const payload: Record<string, unknown> = {
      organization_id: ctx.organizationId,
      environment: body.environment ?? "UAT",
      bulk_customer_id: body.bulkCustomerId ?? body.bulk_customer_id,
      contract_id: body.contractId ?? body.contract_id,
      pickup_dropoff_office_id: body.pickupDropoffOfficeId ?? body.pickup_dropoff_office_id,
      status: "PENDING",
    };
    if (body.username) payload.encrypted_username = encryptSecret(body.username);
    if (body.password) payload.encrypted_password = encryptSecret(body.password);
    const { data, error } = await supabase
      .from("india_post_connections")
      .upsert(payload)
      .select()
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    if (body.barcodeRange) {
      await supabase.from("barcode_ranges").upsert({
        organization_id: ctx.organizationId,
        prefix: body.barcodeRange.prefix,
        suffix: body.barcodeRange.suffix ?? "IN",
        start_number: body.barcodeRange.startNumber,
        end_number: body.barcodeRange.endNumber,
        next_number: body.barcodeRange.nextNumber ?? body.barcodeRange.startNumber,
        is_active: true,
      });
    }
    await supabase.from("audit_logs").insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.userId,
      action: "india_post.connected",
      entity_type: "india_post_connection",
      entity_id: data.id,
    });
    return { saved: true, status: data.status };
  }

  if (key === "POST integrations/india-post/verify" || key === "POST integrations/india-post/test") {
    const { data } = await supabase
      .from("india_post_connections")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    const provider = indiaPostFromRow(data);
    const tokens = await provider.login();
    await supabase
      .from("india_post_connections")
      .update({
        status: "CONNECTED",
        last_verified_at: new Date().toISOString(),
        last_refreshed_at: new Date().toISOString(),
        encrypted_access_token: encryptSecret(tokens.access_token),
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        last_error: null,
      })
      .eq("organization_id", ctx.organizationId);
    return { verified: true };
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
    const body = await request.json();
    const token = randomToken(16);
    const { data, error } = await supabase
      .from("organization_invites")
      .insert({
        organization_id: ctx.organizationId,
        email: body.email,
        role: body.role ?? "OPERATOR",
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
    const body = await request.json();
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
      .select("*")
      .eq("organization_id", ctx.organizationId);
    return { items: data ?? [] };
  }

  if (key === "POST webhooks") {
    const body = await request.json();
    const secret = randomToken(16);
    const { data, error } = await supabase
      .from("webhook_endpoints")
      .insert({
        organization_id: ctx.organizationId,
        url: body.url,
        secret_hash: hashSecret(secret),
        events: body.events ?? [...WEBHOOK_EVENTS],
      })
      .select()
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return { ...data, secret };
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
    const [{ data: orders }, { data: shipments }, { data: customers }] = await Promise.all([
      supabase
        .from("orders")
        .select("id, order_number")
        .eq("organization_id", ctx.organizationId)
        .ilike("order_number", `%${q}%`)
        .limit(5),
      supabase
        .from("shipments")
        .select("id, barcode, tracking_number")
        .eq("organization_id", ctx.organizationId)
        .or(`barcode.ilike.%${q}%,tracking_number.ilike.%${q}%`)
        .limit(5),
      supabase
        .from("customers")
        .select("id, name, phone")
        .eq("organization_id", ctx.organizationId)
        .ilike("name", `%${q}%`)
        .limit(5),
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
    const { error } = await supabase.from("billing_plans").select("id").limit(1);
    return {
      api: "Healthy",
      database: error ? "Error" : "Healthy",
      redis: "Warning",
      shopify: isShopifyAppConfigured() ? "Healthy" : "Warning",
      indiaPost: env.indiaPostUatBaseUrl || env.indiaPostProdBaseUrl ? "Warning" : "Warning",
    };
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}

async function dispatch(request: NextRequest, context: { params: Promise<{ slug: string[] }> }) {
  const requestId = createRequestId();
  const started = Date.now();
  try {
    const { slug } = await context.params;
    const result = await handle(request, slug);
    logInfo("api.request", {
      requestId,
      path: request.nextUrl.pathname,
      method: request.method,
      latency: Date.now() - started,
    });
    if (result instanceof Response) return result;
    return ok(result, "OK", requestId);
  } catch (error) {
    logError("api.error", {
      requestId,
      path: request.nextUrl.pathname,
      message: error instanceof Error ? error.message : "unknown",
    });
    return fail(error, requestId);
  }
}

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
