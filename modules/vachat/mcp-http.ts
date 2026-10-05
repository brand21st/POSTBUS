import { NextRequest, NextResponse } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { fail } from "@/lib/api/response";
import { logError, logInfo } from "@/lib/logger";
import { rateLimit } from "@/lib/security/rate-limit";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import {
  authorizeVachatMcp,
  handleMcpRpc,
  initializeResult,
  isJsonRpcPayload,
  mcpCorsHeaders,
  mcpTools,
  parseSearchOrderDetailsArgs,
  mcpToolCallResult,
  searchOrderDetails,
} from "@/modules/vachat/mcp";

function mcpResponse(body: unknown, status = 200) {
  const headers = mcpCorsHeaders();
  if (body == null) return new NextResponse(null, { status, headers });
  return NextResponse.json(body, { status, headers });
}

function withCors(response: NextResponse) {
  for (const [key, value] of Object.entries(mcpCorsHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

function failMcp(error: unknown) {
  return withCors(fail(error));
}

function limit(request: NextRequest) {
  const key = `${request.headers.get("x-forwarded-for") ?? "local"}:vachat-mcp`;
  if (!rateLimit(key, 60).ok) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "Too many MCP requests. Try again shortly.");
  }
}

export async function handleVachatMcpRequest(request: NextRequest) {
  try {
    if (request.method === "OPTIONS") {
      return mcpResponse(null, 204);
    }
    limit(request);
    await authorizeVachatMcp(request.headers);
    if (request.method === "GET") {
      return mcpResponse({
        ...initializeResult(),
        tools: mcpTools(),
      });
    }
    if (request.method === "DELETE") {
      return mcpResponse(null, 204);
    }
    if (request.method !== "POST") {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
    }
    if (!hasAdminClient()) {
      throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "PostBus search is not configured.");
    }
    const raw = await request.json().catch(() => null);
    const supabase = createAdminClient();
    const search = (args: Parameters<typeof searchOrderDetails>[1]) => searchOrderDetails(supabase, args);

    if (isJsonRpcPayload(raw)) {
      const handled = await handleMcpRpc(raw, search);
      logInfo("vachat.mcp.rpc", { method: Array.isArray(raw) ? "batch" : (raw as { method?: string })?.method });
      return mcpResponse(handled.body, handled.status);
    }

    const args = parseSearchOrderDetailsArgs(raw);
    const result = await search(args);
    logInfo("vachat.mcp.search", { found: result.found, orders: result.results.length });
    return mcpResponse(mcpToolCallResult(result));
  } catch (error) {
    logError("vachat.mcp.failed", { message: error instanceof Error ? error.message : "unknown" });
    return failMcp(error);
  }
}
