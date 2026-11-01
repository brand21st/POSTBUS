import {
  DOCUMENTED_ACCESS_TOKEN_LIFETIME_SEC,
  REQUEST_TIMEOUT_MS,
  TOKEN_SKEW_MS,
  sessionUrl,
  type DiagnosticConfig,
} from "./env";
import { inspectToken } from "./inspect-token";
import { sanitizeJson, tokenPresence } from "./sanitize";

export type SessionTokens = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
};

const SAFE_RESPONSE_HEADERS = [
  "content-type",
  "date",
  "server",
  "www-authenticate",
  "x-request-id",
  "x-correlation-id",
  "x-amzn-requestid",
  "x-amzn-trace-id",
  "cf-ray",
  "retry-after",
  "cache-control",
  "vary",
];

export type HttpCallResult = {
  httpStatus: number;
  ok: boolean;
  json: unknown;
  text: string;
  durationMs: number;
  utcTimestamp: string;
  requestMethod: string;
  urlHost: string;
  urlPath: string;
  authorizationHeader: "PRESENT" | "ABSENT";
  authorizationScheme?: "Bearer";
  bearerKind?: "access_token" | "refresh_token" | "none";
  contentTypeSent: string | null;
  acceptSent: string | null;
  requestHeaderNames: string[];
  responseHeaderNames: string[];
  responseHeaders: Record<string, string>;
  contentTypeReceived: string | null;
};

export type LoginResult = {
  success: boolean;
  httpStatus: number;
  tokens: SessionTokens | null;
  source: "FRESH_LOGIN" | "TOKEN_REFRESH";
  accessToken: "GENERATED" | "MISSING";
  refreshToken: "GENERATED" | "MISSING";
  idToken: "GENERATED" | "MISSING";
  expiresIn: number | null;
  refreshExpiresIn: number | null;
  expiresAtMs: number | null;
  refreshExpiresAtMs: number | null;
  expirySource: "API" | "DOCUMENTED_15_MIN" | "MISSING";
  sanitized: unknown;
  errorMessage?: string;
};

function headerRecord(headers: Headers) {
  const names: string[] = [];
  const safe: Record<string, string> = {};
  headers.forEach((value, name) => {
    names.push(name);
    if (SAFE_RESPONSE_HEADERS.includes(name.toLowerCase())) safe[name.toLowerCase()] = value;
  });
  return { names: names.sort(), safe };
}

async function readResponse(
  response: Response,
  startedAt: number,
  url: string,
  init: RequestInit,
  bearerKind: HttpCallResult["bearerKind"]
): Promise<HttpCallResult> {
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const parsed = new URL(url);
  const sent = new Headers(init.headers);
  const received = headerRecord(response.headers);
  return {
    httpStatus: response.status,
    ok: response.ok,
    json,
    text: text.slice(0, 4000),
    durationMs: Date.now() - startedAt,
    utcTimestamp: new Date(startedAt).toISOString(),
    requestMethod: String(init.method ?? "GET").toUpperCase(),
    urlHost: parsed.hostname,
    urlPath: parsed.pathname,
    authorizationHeader: sent.has("authorization") ? "PRESENT" : "ABSENT",
    authorizationScheme: bearerKind === "none" ? undefined : "Bearer",
    bearerKind,
    contentTypeSent: sent.get("content-type"),
    acceptSent: sent.get("accept"),
    requestHeaderNames: [...sent.keys()].sort(),
    responseHeaderNames: received.names,
    responseHeaders: received.safe,
    contentTypeReceived: response.headers.get("content-type"),
  };
}

export async function indiaPostFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  bearerKind: HttpCallResult["bearerKind"] = "none"
): Promise<HttpCallResult> {
  const startedAt = Date.now();
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  return readResponse(response, startedAt, url, init, bearerKind);
}

function parseTokens(json: unknown): SessionTokens | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const access = typeof row.access_token === "string" ? row.access_token.trim() : "";
  if (!access) return null;
  const expiresRaw = row.expires_in;
  const expires_in = typeof expiresRaw === "number" && Number.isFinite(expiresRaw) ? expiresRaw : undefined;
  const refreshRaw = row.refresh_expires_in;
  return {
    access_token: access,
    refresh_token: typeof row.refresh_token === "string" && row.refresh_token.trim() ? row.refresh_token.trim() : undefined,
    id_token: typeof row.id_token === "string" && row.id_token.trim() ? row.id_token.trim() : undefined,
    expires_in,
    refresh_expires_in:
      typeof refreshRaw === "number" && Number.isFinite(refreshRaw) ? refreshRaw : undefined,
  };
}

function loginEnvelopeOk(json: unknown) {
  return Boolean(json && typeof json === "object" && (json as { success?: unknown }).success === true);
}

function expiryMeta(tokens: SessionTokens | null, now = Date.now()) {
  if (!tokens) {
    return {
      expiresIn: null as number | null,
      refreshExpiresIn: null as number | null,
      expiresAtMs: null as number | null,
      refreshExpiresAtMs: null as number | null,
      expirySource: "MISSING" as const,
    };
  }
  const apiExpires = tokens.expires_in != null && tokens.expires_in > 0 ? tokens.expires_in : null;
  const expirySource = apiExpires != null ? ("API" as const) : ("DOCUMENTED_15_MIN" as const);
  const expiresIn = apiExpires ?? DOCUMENTED_ACCESS_TOKEN_LIFETIME_SEC;
  return {
    expiresIn: tokens.expires_in ?? null,
    refreshExpiresIn: tokens.refresh_expires_in ?? null,
    expiresAtMs: now + expiresIn * 1000,
    refreshExpiresAtMs:
      tokens.refresh_expires_in != null && tokens.refresh_expires_in > 0
        ? now + tokens.refresh_expires_in * 1000
        : null,
    expirySource,
  };
}

export function accessTokenExpired(expiresAtMs: number | null, now = Date.now()) {
  if (expiresAtMs == null) return true;
  return expiresAtMs - now <= TOKEN_SKEW_MS;
}

export function formatLoginBlock(result: LoginResult, title = "LOGIN TEST") {
  const lines = [
    title,
    "-----------",
    `HTTP Status: ${result.httpStatus}`,
    `Authentication: ${result.success ? "SUCCESS" : "FAILED"}`,
    `Source: ${result.source === "TOKEN_REFRESH" ? "TOKEN REFRESH SUCCESS" : result.success ? "FRESH LOGIN SUCCESS" : "FAILED"}`,
    `Access Token: ${result.accessToken}`,
    `Refresh Token: ${result.refreshToken}`,
    `ID Token: ${result.idToken}`,
    `Access Token Expiry: ${result.expiresIn ?? "not returned"} (${result.expirySource})`,
    `Refresh Token Expiry: ${result.refreshExpiresIn ?? "not returned"}`,
  ];
  if (result.errorMessage) lines.push(`Error: ${result.errorMessage}`);
  return lines.join("\n");
}

export class TokenManager {
  private tokens: SessionTokens | null = null;
  private expiresAtMs: number | null = null;
  private refreshExpiresAtMs: number | null = null;
  private refreshInFlight: Promise<LoginResult> | null = null;
  lastLogin: LoginResult | null = null;
  lastRefresh: LoginResult | null = null;
  lastSource: LoginResult["source"] | "NONE" = "NONE";

  constructor(private readonly config: DiagnosticConfig) {}

  authorizationHeader(kind: "access_token" | "refresh_token") {
    const token = kind === "access_token" ? this.tokens?.access_token : this.tokens?.refresh_token;
    if (!token) return null;
    return `Bearer ${token}`;
  }

  hasAccessToken() {
    return Boolean(this.tokens?.access_token);
  }

  isAccessExpired(now = Date.now()) {
    return accessTokenExpired(this.expiresAtMs, now);
  }

  snapshot() {
    return {
      accessToken: tokenPresence(this.tokens?.access_token),
      refreshToken: tokenPresence(this.tokens?.refresh_token),
      idToken: tokenPresence(this.tokens?.id_token),
      expiresAtMs: this.expiresAtMs,
      refreshExpiresAtMs: this.refreshExpiresAtMs,
      accessExpired: this.isAccessExpired(),
    };
  }

  inspectSessionTokens() {
    return {
      access: inspectToken("access_token", this.tokens?.access_token),
      refresh: inspectToken("refresh_token", this.tokens?.refresh_token),
      id: inspectToken("id_token", this.tokens?.id_token),
    };
  }

  private remember(tokens: SessionTokens, source: LoginResult["source"], httpStatus: number, json: unknown): LoginResult {
    const meta = expiryMeta(tokens);
    this.tokens = tokens;
    this.expiresAtMs = meta.expiresAtMs;
    this.refreshExpiresAtMs = meta.refreshExpiresAtMs;
    this.lastSource = source;
    const result: LoginResult = {
      success: true,
      httpStatus,
      tokens,
      source,
      accessToken: tokenPresence(tokens.access_token),
      refreshToken: tokenPresence(tokens.refresh_token),
      idToken: tokenPresence(tokens.id_token),
      ...meta,
      sanitized: sanitizeJson(json),
    };
    if (source === "TOKEN_REFRESH") this.lastRefresh = result;
    else this.lastLogin = result;
    return result;
  }

  async authenticateCustomer(): Promise<LoginResult> {
    const url = sessionUrl(this.config.apiRoot, "/access/login");
    const call = await indiaPostFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.config.username,
          password: this.config.password,
        }),
      },
      REQUEST_TIMEOUT_MS.login,
      "none"
    );
    if (!call.ok || !loginEnvelopeOk(call.json)) {
      const message =
        firstMessage(call.json) || (call.httpStatus ? `HTTP ${call.httpStatus}` : "Login failed");
      const failed: LoginResult = {
        success: false,
        httpStatus: call.httpStatus,
        tokens: null,
        source: "FRESH_LOGIN",
        accessToken: "MISSING",
        refreshToken: "MISSING",
        idToken: "MISSING",
        expiresIn: null,
        refreshExpiresIn: null,
        expiresAtMs: null,
        refreshExpiresAtMs: null,
        expirySource: "MISSING",
        sanitized: sanitizeJson(call.json) ?? call.text.slice(0, 500),
        errorMessage: message,
      };
      this.lastLogin = failed;
      return failed;
    }
    const tokens = parseTokens(call.json);
    if (!tokens) {
      const failed: LoginResult = {
        success: false,
        httpStatus: call.httpStatus,
        tokens: null,
        source: "FRESH_LOGIN",
        accessToken: "MISSING",
        refreshToken: "MISSING",
        idToken: "MISSING",
        expiresIn: null,
        refreshExpiresIn: null,
        expiresAtMs: null,
        refreshExpiresAtMs: null,
        expirySource: "MISSING",
        sanitized: sanitizeJson(call.json),
        errorMessage: "Login succeeded envelope was missing access_token.",
      };
      this.lastLogin = failed;
      return failed;
    }
    return this.remember(tokens, "FRESH_LOGIN", call.httpStatus, call.json);
  }

  async refreshAccessToken(): Promise<LoginResult> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.refreshAccessTokenUnqueued().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async refreshAccessTokenUnqueued(): Promise<LoginResult> {
    const refreshToken = this.tokens?.refresh_token;
    if (!refreshToken) {
      return {
        success: false,
        httpStatus: 0,
        tokens: null,
        source: "TOKEN_REFRESH",
        accessToken: "MISSING",
        refreshToken: "MISSING",
        idToken: "MISSING",
        expiresIn: null,
        refreshExpiresIn: null,
        expiresAtMs: null,
        refreshExpiresAtMs: null,
        expirySource: "MISSING",
        sanitized: null,
        errorMessage: "No refresh token is stored in memory.",
      };
    }
    const url = sessionUrl(this.config.apiRoot, this.config.refreshPath);
    const call = await indiaPostFetch(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${refreshToken}` },
      },
      REQUEST_TIMEOUT_MS.refresh,
      "refresh_token"
    );
    if (!call.ok || !loginEnvelopeOk(call.json)) {
      const failed: LoginResult = {
        success: false,
        httpStatus: call.httpStatus,
        tokens: null,
        source: "TOKEN_REFRESH",
        accessToken: "MISSING",
        refreshToken: tokenPresence(refreshToken),
        idToken: "MISSING",
        expiresIn: null,
        refreshExpiresIn: null,
        expiresAtMs: null,
        refreshExpiresAtMs: this.refreshExpiresAtMs,
        expirySource: "MISSING",
        sanitized: sanitizeJson(call.json) ?? call.text.slice(0, 500),
        errorMessage: firstMessage(call.json) || `HTTP ${call.httpStatus}`,
      };
      this.lastRefresh = failed;
      return failed;
    }
    const tokens = parseTokens(call.json);
    if (!tokens) {
      const failed: LoginResult = {
        success: false,
        httpStatus: call.httpStatus,
        tokens: null,
        source: "TOKEN_REFRESH",
        accessToken: "MISSING",
        refreshToken: tokenPresence(refreshToken),
        idToken: "MISSING",
        expiresIn: null,
        refreshExpiresIn: null,
        expiresAtMs: null,
        refreshExpiresAtMs: this.refreshExpiresAtMs,
        expirySource: "MISSING",
        sanitized: sanitizeJson(call.json),
        errorMessage: "Refresh envelope was missing access_token.",
      };
      this.lastRefresh = failed;
      return failed;
    }
    if (!tokens.refresh_token) tokens.refresh_token = refreshToken;
    return this.remember(tokens, "TOKEN_REFRESH", call.httpStatus, call.json);
  }

  async getValidAccessToken(): Promise<{ token: string; source: LoginResult["source"] }> {
    if (this.tokens?.access_token && !this.isAccessExpired()) {
      return {
        token: this.tokens.access_token,
        source: this.lastSource === "TOKEN_REFRESH" ? "TOKEN_REFRESH" : "FRESH_LOGIN",
      };
    }
    if (this.tokens?.refresh_token) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed.success && this.tokens?.access_token) {
        return { token: this.tokens.access_token, source: "TOKEN_REFRESH" };
      }
    }
    const login = await this.authenticateCustomer();
    if (!login.success || !this.tokens?.access_token) {
      throw new Error(login.errorMessage || "Unable to obtain an access token.");
    }
    return { token: this.tokens.access_token, source: "FRESH_LOGIN" };
  }
}

function firstMessage(json: unknown) {
  if (!json || typeof json !== "object") return undefined;
  const row = json as { message?: unknown; error?: { message?: unknown } };
  if (typeof row.message === "string" && row.message.trim()) return row.message.trim();
  if (typeof row.error?.message === "string" && row.error.message.trim()) return row.error.message.trim();
  return undefined;
}
