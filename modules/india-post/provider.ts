import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { timed } from "@/lib/jobs/timing";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { indiaPostBookingFileUrl, indiaPostBookingUrl, indiaPostOfficesFromPincodeResponse, indiaPostSessionUrl } from "@/modules/india-post/endpoints";
import { indiaPostBookingHasArticleOutcomes, indiaPostFormatBookingFailure, indiaPostJoinMessages } from "@/modules/india-post/error-text";
import {
  createIndiaPostLoginError,
  createIndiaPostRefreshError,
  isConfirmedIndiaPostRefreshAuthFailure,
  isIndiaPostRefreshError,
} from "@/modules/india-post/login-auth";
import { INDIA_POST_TIMEOUT_MS, indiaPostTimeoutSignal } from "@/modules/india-post/http";
import { logError, logInfo } from "@/lib/logger";
import {
  accessTokenStillValid,
  INDIA_POST_REFRESH_PATH,
  parseIndiaPostSessionTokens,
  refreshTokenStillValid,
  type IndiaPostSessionTokens,
} from "@/modules/india-post/session-tokens";
import { chunkIds } from "@/modules/india-post/booking-batch";
import { INDIA_POST_TRACKING_BULK_LIMIT } from "@/modules/india-post/spec";
import {
  articlesForRequestedBarcodes,
  parseBulkTrackingResponse,
  retryAfterMsFromHeader,
} from "@/modules/india-post/tracking-response";
import type { ProviderEnvironment } from "@/types/domain";
import { tariffRequest, type TariffInput } from "@/modules/india-post/tariff-contract";

function isTimeoutError(error: unknown) {
  const row = error as { name?: string; code?: string } | null;
  return (
    row?.name === "AbortError" ||
    row?.name === "TimeoutError" ||
    row?.code === "ABORT_ERR" ||
    row?.code === "ETIMEDOUT"
  );
}

export type ShippingProvider = {
  validateShipment(input: Record<string, unknown>): Promise<void>;
  getTariff(input: TariffInput): Promise<unknown>;
  bookShipment(input: Record<string, unknown>): Promise<unknown>;
  allocateBarcode(): Promise<string>;
  generateLabel(input: Record<string, unknown>): Promise<ArrayBuffer>;
  createManifest(input: Record<string, unknown>): Promise<unknown>;
  trackShipment(barcodes: string[]): Promise<unknown>;
  cancelShipment(barcode: string): Promise<unknown>;
};

type Connection = {
  environment: ProviderEnvironment;
  encrypted_username?: string | null;
  encrypted_password?: string | null;
  encrypted_access_token?: string | null;
  encrypted_refresh_token?: string | null;
  encrypted_id_token?: string | null;
  expires_at?: string | null;
  refresh_expires_at?: string | null;
  bulk_customer_id?: string | null;
  contract_id?: string | null;
  pickup_dropoff_office_id?: string | null;
  status?: string;
};

export class IndiaPostProvider implements ShippingProvider {
  constructor(private connection: Connection) {}

  private environment(): ProviderEnvironment {
    return this.connection.environment === "PRODUCTION" ? "PRODUCTION" : "UAT";
  }

  private sessionUrl(path: string) {
    return indiaPostSessionUrl(this.environment(), path);
  }

  private assertConnected() {
    if (
      this.connection.status !== "CONNECTED" &&
      !this.connection.encrypted_username
    ) {
      throw new AppError(
        ERROR_CODES.INTEGRATION_NOT_CONNECTED,
        "India Post is not connected."
      );
    }
  }

  async login() {
    this.assertConnected();
    if (!this.connection.encrypted_username || !this.connection.encrypted_password) {
      throw new AppError(
        ERROR_CODES.INTEGRATION_NOT_CONNECTED,
        "India Post credentials are missing."
      );
    }
    const username = decryptSecret(this.connection.encrypted_username);
    const password = decryptSecret(this.connection.encrypted_password);
    const response = await fetch(this.sessionUrl("/access/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.login),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.success) {
      throw createIndiaPostLoginError(
        response.status,
        typeof json?.message === "string" && json.message.trim()
          ? json.message
          : "India Post authentication failed."
      );
    }
    const tokens = parseIndiaPostSessionTokens(json);
    if (!tokens) {
      throw createIndiaPostLoginError(response.status, "India Post authentication failed.");
    }
    this.rememberSession(tokens);
    return tokens;
  }

  async refreshSession() {
    this.assertConnected();
    if (!this.connection.encrypted_refresh_token) {
      throw createIndiaPostRefreshError(400, "Invalid refresh token");
    }
    const refreshToken = decryptSecret(this.connection.encrypted_refresh_token);
    logInfo("india_post.auth.refresh_attempted", {
      connectionId: (this.connection as { id?: string }).id,
    });
    let response: Response;
    try {
      response = await fetch(this.sessionUrl(INDIA_POST_REFRESH_PATH), {
        method: "POST",
        headers: { Authorization: `Bearer ${refreshToken}` },
        signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.refresh),
      });
    } catch (error) {
      logError("india_post.auth.refresh_failed", {
        connectionId: (this.connection as { id?: string }).id,
        reason: isTimeoutError(error) ? "timeout" : "network",
      });
      throw error;
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.success) {
      const message =
        typeof json?.error?.message === "string" && json.error.message.trim()
          ? json.error.message
          : typeof json?.message === "string" && json.message.trim()
            ? json.message
            : "India Post refresh failed.";
      logError("india_post.auth.refresh_failed", {
        connectionId: (this.connection as { id?: string }).id,
        status: response.status,
      });
      throw createIndiaPostRefreshError(response.status, message);
    }
    const tokens = parseIndiaPostSessionTokens(json);
    if (!tokens) {
      logError("india_post.auth.refresh_failed", {
        connectionId: (this.connection as { id?: string }).id,
        reason: "malformed",
      });
      throw createIndiaPostRefreshError(response.status, "India Post refresh token was rejected.");
    }
    this.rememberSession(tokens);
    logInfo("india_post.auth.refresh_succeeded", {
      connectionId: (this.connection as { id?: string }).id,
    });
    return tokens;
  }

  private rememberSession(tokens: IndiaPostSessionTokens) {
    this.connection.encrypted_access_token = encryptSecret(tokens.access_token);
    this.connection.expires_at = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    this.connection.encrypted_refresh_token = tokens.refresh_token
      ? encryptSecret(tokens.refresh_token)
      : this.connection.encrypted_refresh_token;
    this.connection.encrypted_id_token = tokens.id_token
      ? encryptSecret(tokens.id_token)
      : this.connection.encrypted_id_token;
    if (tokens.refresh_expires_in != null) {
      this.connection.refresh_expires_at = new Date(
        Date.now() + tokens.refresh_expires_in * 1000
      ).toISOString();
    }
  }

  private invalidateAccessToken() {
    this.connection.encrypted_access_token = null;
    this.connection.expires_at = null;
  }

  private canRefresh() {
    return Boolean(this.connection.encrypted_refresh_token) && refreshTokenStillValid(this.connection.refresh_expires_at);
  }

  private async token() {
    const session = await this.ensureSession();
    return session.access_token;
  }

  private async withAuthRetry<T>(run: (token: string) => Promise<T>): Promise<T> {
    const first = await this.token();
    try {
      return await run(first);
    } catch (error) {
      if ((error as { status?: number })?.status !== 401) throw error;
      this.invalidateAccessToken();
      const next = await this.token();
      try {
        return await run(next);
      } catch (retryError) {
        logError("india_post.auth.auth_retry_exhausted", {
          connectionId: (this.connection as { id?: string }).id,
          status: (retryError as { status?: number })?.status,
        });
        throw retryError;
      }
    }
  }

  async validateShipment(input: Record<string, unknown>) {
    const pincode = String(input.pincode ?? "");
    if (!/^\d{6}$/.test(pincode)) {
      const error = new Error("Invalid pincode.");
      (error as { code?: string }).code = "INVALID_PINCODE";
      throw error;
    }
    await this.withAuthRetry(async (token) => {
      const response = await fetch(
        `${this.sessionUrl("/pincode-search")}?pincode=${pincode}&office-type=post`,
        { headers: { Authorization: `Bearer ${token}` }, signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.search) }
      );
      if (!response.ok) {
        const error = new Error("Pincode validation failed.");
        (error as { status?: number }).status = response.status;
        throw error;
      }
    });
  }

  async getTariff(input: TariffInput) {
    const path = tariffRequest(input);
    const token = await this.token();
    const response = await fetch(this.sessionUrl(path), {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.search),
    });
    if (!response.ok) {
      const error = new Error("Tariff lookup failed.");
      (error as { status?: number }).status = response.status;
      throw error;
    }
    return response.json();
  }

  async allocateBarcode(): Promise<string> {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      "No active barcode range is configured for this workspace."
    );
  }

  async ensureSession() {
    if (
      this.connection.encrypted_access_token &&
      accessTokenStillValid(this.connection.expires_at)
    ) {
      return {
        reused: true as const,
        access_token: decryptSecret(this.connection.encrypted_access_token),
        tokens: null,
      };
    }
    if (this.canRefresh()) {
      try {
        const tokens = await this.refreshSession();
        return { reused: false as const, access_token: tokens.access_token, tokens };
      } catch (error) {
        if (isTimeoutError(error)) throw error;
        const malformedEnvelope =
          isIndiaPostRefreshError(error) && /refresh token was rejected/i.test(error.message);
        if (!isConfirmedIndiaPostRefreshAuthFailure(error) && !malformedEnvelope) throw error;
        logInfo("india_post.auth.auth01_fallback", {
          connectionId: (this.connection as { id?: string }).id,
        });
      }
    }
    const tokens = await this.login();
    return { reused: false as const, access_token: tokens.access_token, tokens };
  }

  async bookShipment(input: Record<string, unknown>) {
    this.assertConnected();
    const customId = this.connection.bulk_customer_id;
    if (!customId) {
      throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post customer ID is missing.");
    }
    return this.withAuthRetry(async (token) => {
      const response = await fetch(indiaPostBookingUrl(this.environment(), customId), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ articles: input.articles }),
        signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.book),
      });
      const json = await response.json().catch(() => ({}));
      this.assertBookingResponse(response, json);
      return json;
    });
  }

  async bookShipmentFile(articles: unknown[]) {
    this.assertConnected();
    const customId = this.connection.bulk_customer_id;
    if (!customId) {
      throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post customer ID is missing.");
    }
    return this.withAuthRetry(async (token) => {
      const file = new File([JSON.stringify({ articles })], "articles.json", { type: "application/json" });
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(indiaPostBookingFileUrl(this.environment(), customId), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
        signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.book),
      });
      const json = await response.json().catch(() => ({}));
      this.assertBookingResponse(response, json);
      return json;
    });
  }

  private assertBookingResponse(response: Response, json: unknown) {
    if (indiaPostBookingHasArticleOutcomes(json)) return;
    const payload = json as { success?: boolean };
    if (response.ok && payload?.success !== false) return;
    const error = new Error(indiaPostFormatBookingFailure(json));
    (error as { status?: number }).status = response.status;
    (error as { details?: unknown }).details = json;
    throw error;
  }

  async searchPostOffices(pincode: string) {
    const pin = pincode.replace(/\D/g, "").slice(0, 6);
    if (!/^\d{6}$/.test(pin)) return [];
    return this.withAuthRetry(async (token) => {
      const response = await fetch(
        `${this.sessionUrl("/pincode-search")}?pincode=${pin}&office-type=post`,
        { headers: { Authorization: `Bearer ${token}` }, signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.search) }
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error("Unable to fetch India Post offices. Please try again.");
        (error as { status?: number }).status = response.status;
        throw error;
      }
      return indiaPostOfficesFromPincodeResponse(json);
    });
  }

  async generateLabel(input: Record<string, unknown>) {
    return timed(
      "india_post.label",
      {
        organizationId: Array.isArray(input) ? undefined : input.organizationId,
        shipmentId: Array.isArray(input) ? undefined : input.shipmentId,
        entityId: Array.isArray(input) ? undefined : input.shipmentId,
      },
      async () => {
    const articles = Array.isArray(input)
      ? input
      : Array.isArray(input.payload)
        ? input.payload
        : [input.payload ?? input];
    const timeoutMs =
      !Array.isArray(input) && Number(input.timeoutMs) > 0
        ? Number(input.timeoutMs)
        : INDIA_POST_TIMEOUT_MS.label;
    return this.withAuthRetry(async (token) => {
    const response = await fetch(this.sessionUrl("/label/create/domestic"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(articles),
      signal: indiaPostTimeoutSignal(timeoutMs),
    });
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const isPdf = bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    if (!response.ok || !isPdf) {
      const text = new TextDecoder().decode(bytes);
      let json: { message?: string; error?: { message?: string; field_errors?: Array<{ message?: string }> } } = {};
      try {
        json = JSON.parse(text);
      } catch {
        json = {};
      }
      const fieldError = indiaPostJoinMessages([
        ...(Array.isArray(json.error?.field_errors) ? json.error.field_errors.map((row) => row?.message) : []),
        json.error?.message,
        json.message,
      ]);
      const error = new Error(fieldError || "India Post label generation failed.");
      (error as { status?: number }).status = response.status;
      (error as { code?: string }).code = "LABEL_GENERATION_FAILED";
      throw error;
    }
    return buffer;
    });
      }
    );
  }

  async createManifest() {
    throw new AppError(
      ERROR_CODES.PROVIDER_ERROR,
      "India Post has no separate manifest REST endpoint. Booking submits articles."
    );
  }

  async trackArticle(barcode: string) {
    const article = String(barcode ?? "").trim();
    if (!article) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Tracking number is required.");
    }
    return this.withAuthRetry(async (token) => {
      const response = await fetch(this.sessionUrl(`/tracking/${encodeURIComponent(article)}`), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.track),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error("India Post tracking request failed.");
        (error as { status?: number }).status = response.status;
        (error as { code?: string }).code = `HTTP_${response.status}`;
        throw error;
      }
      const parsed = parseBulkTrackingResponse(body);
      return {
        success: parsed.success !== false,
        data: parsed.data ?? [],
      };
    });
  }

  async trackShipment(barcodes: string[]) {
    const unique = [...new Set(barcodes.map((code) => String(code ?? "").trim()).filter(Boolean))];
    return this.withAuthRetry((token) => this.trackShipmentWithToken(unique, token));
  }

  private async trackShipmentWithToken(unique: string[], token: string) {
    const data: unknown[] = [];
    let lastJson: { success?: boolean; message?: string; data?: unknown[]; error?: { message?: string } } = { data: [] };
    for (const bulk of chunkIds(unique, INDIA_POST_TRACKING_BULK_LIMIT)) {
      const response = await fetch(this.sessionUrl("/tracking/bulk"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bulk }),
        signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.track),
      });
      lastJson = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        data?: unknown[];
        error?: { message?: string };
      };
      if (!response.ok) {
        const message =
          indiaPostJoinMessages([lastJson.error?.message, lastJson.message]) || "Tracking lookup failed.";
        // Freshly booked articles often 400/404 until the first office scan.
        // 403 is "not authorized to access this API" and must not look like empty Routing Steps.
        if (response.status === 400 || response.status === 404) {
          continue;
        }
        const error = new Error(message);
        (error as { status?: number; code?: string; retryAfterMs?: number }).status = response.status;
        (error as { code?: string }).code = `HTTP_${response.status}`;
        if (response.status === 429) {
          (error as { code?: string }).code = "HTTP_429";
          const retryAfterMs = retryAfterMsFromHeader(response.headers.get("retry-after"));
          if (retryAfterMs != null) {
            (error as { retryAfterMs?: number }).retryAfterMs = retryAfterMs;
          }
        }
        throw error;
      }
      const parsed = parseBulkTrackingResponse(lastJson);
      if (parsed.success === false) {
        const message =
          indiaPostJoinMessages([parsed.error?.message, parsed.message != null ? String(parsed.message) : null]) ||
          "Tracking lookup failed.";
        const status = parsed.status_code ?? response.status;
        const error = new Error(message) as { status?: number; code?: string };
        error.status = status;
        if (!(status >= 400 && status < 500 && status !== 429)) {
          error.code = "TEMPORARY_PROVIDER_FAILURE";
        }
        throw error;
      }
      data.push(...articlesForRequestedBarcodes(parsed.data, bulk));
    }
    return { ...lastJson, data };
  }

  async cancelShipment() {
    throw new AppError(
      ERROR_CODES.PROVIDER_ERROR,
      "India Post cancel is not supported by the documented CEPT REST APIs."
    );
  }
}

export function indiaPostFromRow(row: Connection | null) {
  if (!row) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post is not connected.");
  }
  return new IndiaPostProvider(row);
}
