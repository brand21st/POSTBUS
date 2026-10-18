import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { createRequestId, logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { authenticateMerchantApiKey, requireMerchantScope, type MerchantApiKeyContext } from "@/modules/merchant-api/auth";
import { isMerchantApiOpenForOrg } from "@/modules/merchant-api/flags";
import { MerchantApiError, MERCHANT_ERROR_CODES } from "@/modules/merchant-api/errors";
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  fingerprintBody,
  requireIdempotencyKey,
} from "@/modules/merchant-api/idempotency";
import { writeMerchantApiLog } from "@/modules/merchant-api/logs";
import { createMerchantOrder, getMerchantOrder, listMerchantOrders, patchMerchantOrder } from "@/modules/merchant-api/orders";
import { merchantIdentity, merchantPublicSchema } from "@/modules/merchant-api/public-contract";
import {
  assertPayloadSize,
  clientIp,
  consumeMerchantRate,
  MERCHANT_PAYLOAD_LIMITS,
  MERCHANT_RATE_LIMITS,
} from "@/modules/merchant-api/rate-limit";
import { merchantFail, merchantOk } from "@/modules/merchant-api/response";
import { merchantBulkOrdersSchema } from "@/modules/merchant-api/schema";
import {
  bookMerchantOrder,
  getMerchantLabel,
  getMerchantShipment,
  getMerchantTracking,
  listMerchantShipments,
} from "@/modules/merchant-api/shipments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function routeTemplate(method: string, slugs: string[]) {
  const parts = slugs.map((part) => (UUID.test(part) ? ":id" : part));
  return `${method} /${parts.join("/")}`;
}

async function readJson(request: Request) {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MerchantApiError(MERCHANT_ERROR_CODES.VALIDATION_ERROR, "Request body must be JSON.");
  }
}

async function withIdempotency<T>(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  operation: string,
  headerValue: string,
  body: unknown,
  run: () => Promise<T>
): Promise<{ data: T; replayed: boolean }> {
  const started = await beginIdempotency(supabase, organizationId, operation, headerValue, fingerprintBody(body));
  if (started.replay != null) return { data: started.replay as T, replayed: true };
  try {
    const data = await run();
    await completeIdempotency(supabase, organizationId, operation, headerValue, data);
    return { data, replayed: false };
  } catch (error) {
    await failIdempotency(supabase, organizationId, operation, headerValue);
    throw error;
  }
}

async function bulkCreate(supabase: ReturnType<typeof createAdminClient>, ctx: MerchantApiKeyContext, raw: unknown) {
  const body = merchantBulkOrdersSchema.parse(raw);
  await consumeMerchantRate(
    supabase,
    `bulk:${ctx.apiKeyId}`,
    MERCHANT_RATE_LIMITS.bulkRowsPerKey.limit,
    MERCHANT_RATE_LIMITS.bulkRowsPerKey.windowMs
  );
  const results = [];
  for (let index = 0; index < body.orders.length; index += 1) {
    try {
      const created = await createMerchantOrder(supabase, ctx, body.orders[index]);
      results.push({
        index,
        success: true,
        duplicate: created.duplicate,
        order: created.order,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        results.push({
          index,
          success: false,
          error: {
            code: MERCHANT_ERROR_CODES.VALIDATION_ERROR,
            message: "Request validation failed",
            details: error.issues.map((issue) => ({
              field: issue.path.map(String).join("."),
              message: issue.message,
            })),
          },
        });
        continue;
      }
      if (error instanceof MerchantApiError) {
        results.push({
          index,
          success: false,
          error: { code: error.code, message: error.message, details: error.details },
        });
        continue;
      }
      results.push({
        index,
        success: false,
        error: { code: MERCHANT_ERROR_CODES.INTERNAL_ERROR, message: "Unable to create order.", details: [] },
      });
    }
  }
  return { results };
}

export async function handleMerchantV1(request: NextRequest, slugs: string[]) {
  const requestId = createRequestId();
  const started = Date.now();
  const method = request.method.toUpperCase();
  const endpoint = routeTemplate(method, slugs);
  let organizationId: string | null = null;
  let apiKeyId: string | null = null;
  let status = 500;

  try {
    if (!hasAdminClient()) {
      throw new MerchantApiError(
        MERCHANT_ERROR_CODES.UPSTREAM_SERVICE_UNAVAILABLE,
        "Merchant API is not configured."
      );
    }
    const supabase = createAdminClient();
    let ctx: MerchantApiKeyContext;
    try {
      ctx = await authenticateMerchantApiKey(supabase, request);
    } catch (error) {
      if (error instanceof MerchantApiError && error.code === MERCHANT_ERROR_CODES.INVALID_API_KEY) {
        await consumeMerchantRate(
          supabase,
          `authfail:${clientIp(request)}`,
          MERCHANT_RATE_LIMITS.authFailuresPerIp.limit,
          MERCHANT_RATE_LIMITS.authFailuresPerIp.windowMs
        ).catch(() => undefined);
      }
      throw error;
    }
    organizationId = ctx.organizationId;
    apiKeyId = ctx.apiKeyId;
    if (!isMerchantApiOpenForOrg(ctx.organizationId)) {
      throw new MerchantApiError(
        MERCHANT_ERROR_CODES.MERCHANT_API_DISABLED,
        "Merchant API is not enabled for this workspace."
      );
    }

    await consumeMerchantRate(
      supabase,
      `key:${ctx.apiKeyId}`,
      MERCHANT_RATE_LIMITS.generalPerKey.limit,
      MERCHANT_RATE_LIMITS.generalPerKey.windowMs
    );
    await consumeMerchantRate(
      supabase,
      `org:${ctx.organizationId}`,
      MERCHANT_RATE_LIMITS.generalPerOrg.limit,
      MERCHANT_RATE_LIMITS.generalPerOrg.windowMs
    );

    const [root, second, third] = slugs;

    if (method === "GET" && root === "me" && !second) {
      const body = merchantIdentity(ctx);
      status = 200;
      return merchantOk(body, requestId);
    }

    if (method === "GET" && root === "meta" && second === "schema" && !third) {
      status = 200;
      return merchantOk(merchantPublicSchema(), requestId);
    }

    if (method === "POST" && root === "orders" && second === "bulk" && !third) {
      requireMerchantScope(ctx, "orders:write");
      assertPayloadSize(request, MERCHANT_PAYLOAD_LIMITS.bulkBytes);
      const payload = await readJson(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const result = await withIdempotency(supabase, ctx.organizationId, "orders.bulk", idempotencyKey, payload, () =>
        bulkCreate(supabase, ctx, payload)
      );
      status = 200;
      return merchantOk(result.data, requestId);
    }

    if (method === "POST" && root === "orders" && !second) {
      requireMerchantScope(ctx, "orders:write");
      assertPayloadSize(request, MERCHANT_PAYLOAD_LIMITS.defaultBytes);
      const payload = await readJson(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const result = await withIdempotency(supabase, ctx.organizationId, "orders.create", idempotencyKey, payload, () =>
        createMerchantOrder(supabase, ctx, payload)
      );
      status = 201;
      return merchantOk(result.data.order ?? result.data, requestId, result.replayed ? 200 : 201);
    }

    if (method === "GET" && root === "orders" && !second) {
      requireMerchantScope(ctx, "orders:read");
      const data = await listMerchantOrders(supabase, ctx, request.nextUrl.searchParams);
      status = 200;
      return merchantOk(data, requestId);
    }

    if (method === "GET" && root === "orders" && second && UUID.test(second) && !third) {
      requireMerchantScope(ctx, "orders:read");
      const data = await getMerchantOrder(supabase, ctx, second);
      status = 200;
      return merchantOk(data, requestId);
    }

    if (method === "PATCH" && root === "orders" && second && UUID.test(second) && !third) {
      requireMerchantScope(ctx, "orders:write");
      assertPayloadSize(request, MERCHANT_PAYLOAD_LIMITS.defaultBytes);
      const payload = await readJson(request);
      const data = await patchMerchantOrder(supabase, ctx, second, payload);
      status = 200;
      return merchantOk(data, requestId);
    }

    if (method === "POST" && root === "orders" && second && UUID.test(second) && third === "book") {
      requireMerchantScope(ctx, "shipments:book");
      await consumeMerchantRate(
        supabase,
        `book:${ctx.apiKeyId}`,
        MERCHANT_RATE_LIMITS.bookingPerKey.limit,
        MERCHANT_RATE_LIMITS.bookingPerKey.windowMs
      );
      const payload = await readJson(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const result = await withIdempotency(
        supabase,
        ctx.organizationId,
        "orders.book",
        idempotencyKey,
        { orderId: second, payload },
        () => bookMerchantOrder(supabase, ctx, second, payload)
      );
      status = 202;
      return merchantOk(result.data, requestId, result.replayed ? 200 : 202);
    }

    if (method === "GET" && root === "shipments" && !second) {
      requireMerchantScope(ctx, "shipments:read");
      const data = await listMerchantShipments(supabase, ctx, request.nextUrl.searchParams);
      status = 200;
      return merchantOk(data, requestId);
    }

    if (method === "GET" && root === "shipments" && second && UUID.test(second) && !third) {
      requireMerchantScope(ctx, "shipments:read");
      const data = await getMerchantShipment(supabase, ctx, second);
      status = 200;
      return merchantOk(data, requestId);
    }

    if (method === "GET" && root === "shipments" && second && UUID.test(second) && third === "tracking") {
      requireMerchantScope(ctx, "tracking:read");
      const data = await getMerchantTracking(supabase, ctx, second);
      status = 200;
      return merchantOk(data, requestId);
    }

    if (method === "GET" && root === "shipments" && second && UUID.test(second) && third === "label") {
      requireMerchantScope(ctx, "labels:read");
      const response = await getMerchantLabel(supabase, ctx, second);
      status = 200;
      response.headers.set("X-Request-Id", requestId);
      return response;
    }

    throw new MerchantApiError(MERCHANT_ERROR_CODES.RESOURCE_NOT_FOUND, "Unknown Merchant API route.");
  } catch (error) {
    const response = merchantFail(error, requestId);
    status = response.status;
    if (!(error instanceof MerchantApiError) && !(error instanceof ZodError)) {
      logError("merchant_api.error", {
        requestId,
        endpoint,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
    return response;
  } finally {
    if (organizationId) {
      const supabase = hasAdminClient() ? createAdminClient() : null;
      if (supabase) {
        void writeMerchantApiLog(supabase, {
          organizationId,
          apiKeyId,
          endpoint,
          method,
          responseStatus: status,
          durationMs: Date.now() - started,
          requestId,
        });
      }
    }
  }
}
