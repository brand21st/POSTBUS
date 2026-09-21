import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { logError } from "@/lib/logger";
import { encryptSecret, maskSecret } from "@/lib/security/crypto";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { indiaPostWebhookUrls } from "@/modules/india-post/webhook-urls";
import { isCeptUatTestSeries, parseBarcodeRange } from "@/modules/india-post/barcode";
import { listContracts, saveContracts } from "@/modules/india-post/contracts";
import { DEFAULT_INDIA_POST_SERVICE } from "@/types/domain";
import {
  createShopifyOAuthState,
  exchangeShopifyToken,
  hasStoredClientSecret,
  normalizeShopDomain,
  oauthStateMatches,
  parseShopifyOAuthState,
  resolveShopifyAppCredentials,
  shopifyAppConfiguredFor,
  shopifyInstallUrl,
  shopifyOAuthCookieOptions,
  shopifyWebhookUrl,
  SHOPIFY_OAUTH_STATE_COOKIE,
  storedClientId,
  verifyShopifyHmac,
} from "@/modules/shopify/oauth";
import { shopifyReadyToSync, syncUnfulfilledShopifyOrders } from "@/modules/shopify/orders";

export async function handleIntegrationRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  ctx: TenantContext,
  key: string
) {
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
    const state = createShopifyOAuthState(ctx.organizationId);
    const response = NextResponse.redirect(shopifyInstallUrl(shop, state, creds));
    response.cookies.set(SHOPIFY_OAUTH_STATE_COOKIE, state, shopifyOAuthCookieOptions());
    return response;
  }

  if (key === "GET integrations/shopify/callback") {
    const failRedirect = (message: string) => {
      const response = NextResponse.redirect(
        `${env.appUrl}/dashboard/integrations/shopify?error=${encodeURIComponent(message)}`
      );
      response.cookies.delete(SHOPIFY_OAUTH_STATE_COOKIE);
      return response;
    };
    const params = request.nextUrl.searchParams;
    if (params.get("error")) {
      return failRedirect(params.get("error_description") || params.get("error") || "Shopify denied access.");
    }
    const receivedState = params.get("state");
    const storedState = request.cookies.get(SHOPIFY_OAUTH_STATE_COOKIE)?.value;
    const parsed = parseShopifyOAuthState(receivedState);
    if (!oauthStateMatches(storedState, receivedState) || parsed?.organizationId !== ctx.organizationId) {
      return failRedirect("Shopify connection state was invalid. Start the install again.");
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
      const response = NextResponse.redirect(`${env.appUrl}/dashboard/integrations/shopify`);
      response.cookies.delete(SHOPIFY_OAUTH_STATE_COOKIE);
      return response;
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
    const { data: ranges } = await supabase
      .from("barcode_ranges")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .eq("is_active", true)
      .order("service_code", { nullsFirst: true });
    const contracts = await listContracts(supabase, ctx.organizationId);
    const range = ranges?.[0] ?? null;
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
      uatConfigured: Boolean(env.indiaPostUatBaseUrl),
      prodConfigured: Boolean(env.indiaPostProdBaseUrl),
      ...(data?.id ? indiaPostWebhookUrls(data.id) : {}),
      contracts,
      defaultServiceCode:
        contracts.find((contract) => contract.isDefault)?.serviceCode ?? DEFAULT_INDIA_POST_SERVICE,
      barcodeRange: range
        ? {
            prefix: range.prefix,
            suffix: range.suffix,
            startNumber: range.start_number,
            endNumber: range.end_number,
            nextNumber: range.next_number,
            serviceCode: range.service_code ?? null,
          }
        : null,
      barcodeRanges: (ranges ?? []).map((item) => ({
        prefix: item.prefix,
        suffix: item.suffix,
        startNumber: item.start_number,
        endNumber: item.end_number,
        nextNumber: item.next_number,
        serviceCode: item.service_code ?? null,
      })),
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
      .upsert(payload, { onConflict: "organization_id" })
      .select()
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

    if (Array.isArray(body.contracts)) {
      await saveContracts(supabase, ctx.organizationId, body.contracts);
    }

    if (body.barcodeRange) {
      const parsed = parseBarcodeRange(body.barcodeRange);
      const environment = payload.environment ?? data.environment;
      if (
        environment === "PRODUCTION" &&
        isCeptUatTestSeries(parsed.prefix, parsed.startNumber, parsed.endNumber)
      ) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          "ET21433001–21434000 is the CEPT UAT test series. Production must use the CL series India Post allotted your contract."
        );
      }

      // Saving twice used to add a second active row, and the booking worker's
      // single-row lookup then failed. Retire the current series for this service
      // first, which is also how a used-up series gets replaced.
      let retire = supabase
        .from("barcode_ranges")
        .update({ is_active: false })
        .eq("organization_id", ctx.organizationId)
        .eq("is_active", true);
      retire = parsed.serviceCode
        ? retire.eq("service_code", parsed.serviceCode)
        : retire.is("service_code", null);
      const { error: retireError } = await retire;
      if (retireError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, retireError.message);

      const { error: rangeError } = await supabase.from("barcode_ranges").insert({
        organization_id: ctx.organizationId,
        service_code: parsed.serviceCode,
        prefix: parsed.prefix,
        suffix: parsed.suffix,
        start_number: parsed.startNumber,
        end_number: parsed.endNumber,
        next_number: body.barcodeRange.nextNumber ?? parsed.startNumber,
        is_active: true,
      });
      if (rangeError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, rangeError.message);
    }

    // Save & connect: verify CEPT login immediately so the badge turns Connected (green).
    let status = data.status ?? "PENDING";
    let lastError: string | null = null;
    try {
      const provider = indiaPostFromRow(data);
      const tokens = await provider.login();
      const verifiedAt = new Date().toISOString();
      const { data: connected, error: connectError } = await supabase
        .from("india_post_connections")
        .update({
          status: "CONNECTED",
          last_verified_at: verifiedAt,
          last_refreshed_at: verifiedAt,
          encrypted_access_token: encryptSecret(tokens.access_token),
          expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          last_error: null,
        })
        .eq("organization_id", ctx.organizationId)
        .select()
        .single();
      if (connectError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, connectError.message);
      status = connected?.status ?? "CONNECTED";
    } catch (err) {
      lastError = err instanceof Error ? err.message : "India Post login failed.";
      await supabase
        .from("india_post_connections")
        .update({ status: "PENDING", last_error: lastError })
        .eq("organization_id", ctx.organizationId);
      throw err instanceof AppError
        ? err
        : new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, lastError);
    }

    await supabase.from("audit_logs").insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.userId,
      action: "india_post.connected",
      entity_type: "india_post_connection",
      entity_id: data.id,
    });
    return { saved: true, status, lastError };
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

  return null;
}
