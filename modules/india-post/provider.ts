import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { timed } from "@/lib/jobs/timing";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { indiaPostArticlesFileJson } from "@/modules/india-post/spec";
import { indiaPostBookingFileUrl, indiaPostBookingUrl, indiaPostOfficesFromPincodeResponse, indiaPostSessionUrl } from "@/modules/india-post/endpoints";
import { indiaPostBookingHasArticleOutcomes, indiaPostFormatBookingFailure, indiaPostJoinMessages } from "@/modules/india-post/error-text";
import {
  createIndiaPostLoginError,
  createIndiaPostRefreshError,
  isConfirmedIndiaPostRefreshAuthFailure,
  isIndiaPostRefreshError,
} from "@/modules/india-post/login-auth";
import { INDIA_POST_TIMEOUT_MS, indiaPostBookingTimeoutMs, indiaPostTimeoutSignal } from "@/modules/india-post/http";
import { logError, logInfo } from "@/lib/logger";
import {
  accessTokenStillValid,
  INDIA_POST_REFRESH_PATH,
  parseIndiaPostSessionTokens,
  refreshTokenStillValid,
  type IndiaPostSessionTokens,
} from "@/modules/india-post/session-tokens";
import { chunkIds } from "@/modules/india-post/booking-batch";

/** Unit tests stub fetch. A real fetch from a test process must not leave the machine. */
export function assertTestProcessCannotReachLiveCept(url: string) {
  const testProcess = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  if (!testProcess) return;
  const fetchFn = globalThis.fetch as { mock?: unknown } | undefined;
  if (fetchFn && typeof fetchFn === "function" && "mock" in fetchFn) return;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw Object.assign(new Error("India Post booking URL is invalid."), { code: "CEPT_ISOLATION" });
  }
  if (host === "127.0.0.1" || host === "localhost" || host === "::1" || host.endsWith(".localhost")) return;
  throw Object.assign(new Error("Refusing a live India Post booking POST from a test process."), {
    code: "CEPT_ISOLATION",
  });
}
import {
  INDIA_POST_EVENT_DOWNLOAD_OVERLAP_DAYS,
  INDIA_POST_TRACKING_API_FORBIDDEN_COOLDOWN_MS,
  INDIA_POST_TRACKING_REQUEST_CHUNK,
} from "@/modules/india-post/spec";
import {
  indiaPostEventCustomerId,
  indiaPostEventDates,
  mergeEventDownloadArticles,
  parseIndiaPostEventDownloadBody,
} from "@/modules/india-post/event-download";
import { eventDownloadLockKey, withEventDownloadLock } from "@/modules/india-post/event-download-lock";
import {
  chunkOutcomeForHttpStatus,
  classifyAcceptedChunk,
  hardFailureError,
  isTimeoutError,
  summarizeTrackingSync,
  type TrackingChunkOutcome,
  type TrackingHardFailure,
} from "@/modules/india-post/tracking-outcomes";
import { parseBulkTrackingResponse, retryAfterMsFromHeader } from "@/modules/india-post/tracking-response";
import type { BulkTrackingArticle } from "@/modules/india-post/apply-tracking";
import type { ProviderEnvironment } from "@/types/domain";
import { tariffRequest, type TariffInput } from "@/modules/india-post/tariff-contract";

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
    const bookingUrl = indiaPostBookingUrl(this.environment(), customId);
    assertTestProcessCannotReachLiveCept(bookingUrl);
    return this.withAuthRetry(async (token) => {
      const response = await fetch(bookingUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ articles: input.articles }),
        signal: indiaPostTimeoutSignal(
          indiaPostBookingTimeoutMs(Array.isArray(input.articles) ? input.articles.length : 1, "json")
        ),
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
    const fileUrl = indiaPostBookingFileUrl(this.environment(), customId);
    assertTestProcessCannotReachLiveCept(fileUrl);
    return this.withAuthRetry(async (token) => {
      const file = new File([indiaPostArticlesFileJson(articles)], "articles.json", { type: "application/json" });
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(fileUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
        signal: indiaPostTimeoutSignal(indiaPostBookingTimeoutMs(articles.length, "file")),
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
    return this.trackShipment([article]);
  }

  /**
   * TNT01/TNT02 first. Event Download is used only while CEPT denies the tracking
   * APIs with 403 ("You are not authorized to access this API").
   */
  async trackShipment(barcodes: string[], eventDates?: string[]) {
    const unique = uniqueBarcodes(barcodes);
    const viaApi = await this.trackViaTrackingApi(unique);
    if (!viaApi.forbidden) return summarizeTrackingFetch(unique, viaApi);
    logInfo("india_post.tracking.api_forbidden_fallback", {
      connectionId: (this.connection as { id?: string }).id,
      barcodes: unique.length,
    });
    const dates = eventDates?.length ? eventDates : indiaPostEventDates(INDIA_POST_EVENT_DOWNLOAD_OVERLAP_DAYS);
    return summarizeTrackingFetch(unique, await this.downloadLatestEvents(dates));
  }

  private trackingApiKey() {
    return `${this.environment()}:${String(this.connection.bulk_customer_id ?? "").trim()}`;
  }

  /** True while a recent TNT01/TNT02 403 says this customer is not entitled to the tracking APIs. */
  trackingApiForbidden() {
    const until = trackingApiForbiddenUntil.get(this.trackingApiKey()) ?? 0;
    return until > Date.now();
  }

  /**
   * One barcode: TNT01 GET /v1/tracking/{barcode}, then TNT02 if TNT01 rejects the request.
   * Several: TNT02 POST /v1/tracking/bulk with { bulk: [...] } in chunks.
   * Returns forbidden=true (no throw) on 403 so callers can fall back to Event Download.
   */
  async trackViaTrackingApi(barcodes: string[]): Promise<TrackingFetchResult> {
    this.assertConnected();
    const unique = uniqueBarcodes(barcodes);
    const result: TrackingFetchResult = {
      articles: [],
      chunkOutcomes: [],
      batchesAttempted: 0,
      batchesSucceeded: 0,
      batchesFailed: 0,
      emptyNoContent: false,
      httpStatus: null,
      forbidden: false,
    };
    if (!unique.length) return result;
    if (this.trackingApiForbidden()) {
      return {
        ...result,
        chunkOutcomes: ["CHUNK_HTTP_403"],
        hardFailure: { status: 403, code: "HTTP_403" },
        httpStatus: 403,
        forbidden: true,
      };
    }

    const record = (chunk: TrackingChunkResult) => {
      result.batchesAttempted += 1;
      result.httpStatus = chunk.status;
      result.chunkOutcomes.push(chunk.outcome);
      if (chunk.articles) {
        result.batchesSucceeded += 1;
        result.articles.push(...chunk.articles);
        if (!chunk.articles.length) result.emptyNoContent = true;
      } else {
        result.batchesFailed += 1;
      }
    };

    if (unique.length === 1) {
      const single = await this.withAuthRetry((token) => this.requestTracking(token, "TNT01", unique));
      if (single.articles || single.failure) {
        record(single);
        if (single.failure) result.hardFailure = single.failure;
        else trackingApiForbiddenUntil.delete(this.trackingApiKey());
        return result;
      }
      // 400/403/404 on TNT01: the documented TNT02 contract is the authority, so ask it too.
      logInfo("india_post.tracking.tnt01_rejected", { status: single.status });
    }

    for (const bulk of chunkIds(unique, INDIA_POST_TRACKING_REQUEST_CHUNK)) {
      const chunk = await this.withAuthRetry((token) => this.requestTracking(token, "TNT02", bulk));
      record(chunk);
      if (chunk.status === 403) {
        trackingApiForbiddenUntil.set(this.trackingApiKey(), Date.now() + INDIA_POST_TRACKING_API_FORBIDDEN_COOLDOWN_MS);
        result.hardFailure = { status: 403, code: "HTTP_403" };
        result.forbidden = result.batchesSucceeded === 0;
        break;
      }
      if (chunk.failure) {
        result.hardFailure = chunk.failure;
        break;
      }
    }
    if (!result.forbidden && result.batchesSucceeded > 0) {
      trackingApiForbiddenUntil.delete(this.trackingApiKey());
    }
    return result;
  }

  /**
   * One CEPT tracking call. Throws only on 401 so withAuthRetry can refresh the session.
   * articles set = accepted response. failure set = stop the run (timeout, 429, 5xx, bad body).
   * Neither set = rejected request (400/403/404, or success:false with a 4xx code).
   */
  private async requestTracking(token: string, api: "TNT01" | "TNT02", barcodes: string[]): Promise<TrackingChunkResult> {
    let response: Response;
    try {
      response =
        api === "TNT01"
          ? await fetch(this.sessionUrl(`/tracking/${encodeURIComponent(barcodes[0])}`), {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` },
              signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.track),
            })
          : await fetch(this.sessionUrl("/tracking/bulk"), {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ bulk: barcodes }),
              signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.track),
            });
    } catch (error) {
      return {
        status: null,
        outcome: "NETWORK_TIMEOUT",
        failure: isTimeoutError(error) ? { name: "AbortError", code: "ETIMEDOUT" } : { code: "NETWORK_TIMEOUT" },
      };
    }

    if (response.status === 401) {
      throw Object.assign(new Error("India Post tracking request was rejected."), { status: 401, code: "HTTP_401" });
    }
    if (response.status === 400 || response.status === 403 || response.status === 404) {
      return { status: response.status, outcome: chunkOutcomeForHttpStatus(response.status) };
    }
    if (response.status === 429) {
      return {
        status: 429,
        outcome: "CHUNK_HTTP_429",
        failure: {
          status: 429,
          code: "HTTP_429",
          retryAfterMs: retryAfterMsFromHeader(response.headers?.get?.("retry-after") ?? null) ?? undefined,
        },
      };
    }
    if (!response.ok) {
      return {
        status: response.status,
        outcome: chunkOutcomeForHttpStatus(response.status),
        failure: {
          status: response.status,
          code: response.status >= 500 ? "TEMPORARY_PROVIDER_FAILURE" : `HTTP_${response.status}`,
        },
      };
    }

    const text = await readResponseText(response);
    if (response.status === 204 || !text.trim()) {
      return { status: response.status, outcome: "SUCCESS_WITH_EMPTY_HISTORY", articles: [] };
    }
    let parsed: ReturnType<typeof parseBulkTrackingResponse>;
    try {
      parsed = parseBulkTrackingResponse(JSON.parse(text));
    } catch {
      return { status: response.status, outcome: "PARSE_FAILURE", failure: { status: 502, code: "TEMPORARY_PROVIDER_FAILURE" } };
    }
    if (parsed.success === false) {
      const status = parsed.status_code ?? response.status;
      const message = indiaPostJoinMessages([parsed.error?.message, parsed.message != null ? String(parsed.message) : null]);
      if (status === 403 || /not authori[sz]ed/i.test(message)) {
        return { status: 403, outcome: "CHUNK_HTTP_403" };
      }
      if (status === 401) {
        throw Object.assign(new Error(message || "India Post tracking request was rejected."), { status: 401, code: "HTTP_401" });
      }
      if (status >= 400 && status < 500 && status !== 429) {
        return { status, outcome: chunkOutcomeForHttpStatus(status) };
      }
      return { status, outcome: "INVALID_RESPONSE", failure: { status: 502, code: "TEMPORARY_PROVIDER_FAILURE" } };
    }
    const classified = classifyAcceptedChunk(barcodes, (parsed.data ?? []) as BulkTrackingArticle[]);
    return { status: response.status, outcome: classified.outcome, articles: classified.articles };
  }

  /**
   * POST /v1/event/download with Cust_Id, Event_Code LE, Event_Date.
   * Customer/date feed — not a per-AWB live lookup. Does not call /tracking/bulk.
   */
  async downloadLatestEvents(eventDates: string[]) {
    const customerId = indiaPostEventCustomerId(this.connection.bulk_customer_id);
    if (!customerId) {
      const error = new Error("India Post customer ID is missing or invalid for event download.");
      (error as { status?: number; code?: string }).status = 400;
      (error as { status?: number; code?: string }).code = "TRACKING_CUSTOMER_ID_INVALID";
      throw error;
    }
    const dates = [...new Set(eventDates.map((value) => String(value ?? "").trim()).filter((value) => /^\d{8}$/.test(value)))];
    return withEventDownloadLock(eventDownloadLockKey(customerId, dates), () =>
      this.withAuthRetry((token) => this.downloadLatestEventsWithToken(token, customerId, dates))
    );
  }

  private async downloadLatestEventsWithToken(token: string, customerId: string, dates: string[]) {
    const collected: BulkTrackingArticle[] = [];
    const chunkOutcomes: TrackingChunkOutcome[] = [];
    let batchesAttempted = 0;
    let batchesSucceeded = 0;
    let batchesFailed = 0;
    let hardFailure: TrackingHardFailure | undefined;
    let emptyNoContent = false;
    let httpStatus: number | null = null;

    for (const eventDate of dates) {
      batchesAttempted += 1;
      let response: Response;
      try {
        response = await this.postEventDownload(token, customerId, eventDate);
      } catch (error) {
        batchesFailed += 1;
        chunkOutcomes.push("NETWORK_TIMEOUT");
        hardFailure = isTimeoutError(error)
          ? { name: "AbortError", code: "ETIMEDOUT" }
          : { code: "NETWORK_TIMEOUT" };
        break;
      }

      const text = await readResponseText(response);
      httpStatus = response.status;
      if (response.status === 401) {
        const error = new Error("India Post event download was rejected.");
        (error as { status?: number; code?: string }).status = 401;
        (error as { status?: number; code?: string }).code = "HTTP_401";
        throw error;
      }
      if (response.status === 403) {
        batchesFailed += 1;
        chunkOutcomes.push("CHUNK_HTTP_403");
        hardFailure = { status: 403, code: "HTTP_403" };
        break;
      }
      if (response.status === 429) {
        batchesFailed += 1;
        chunkOutcomes.push("CHUNK_HTTP_429");
        hardFailure = {
          status: 429,
          code: "HTTP_429",
          retryAfterMs: retryAfterMsFromHeader(response.headers?.get?.("retry-after") ?? null) ?? undefined,
        };
        break;
      }
      if (!response.ok) {
        batchesFailed += 1;
        const outcome = chunkOutcomeForHttpStatus(response.status);
        chunkOutcomes.push(outcome);
        if (response.status === 400 || response.status === 404) continue;
        hardFailure = {
          status: response.status,
          code: response.status >= 500 ? "TEMPORARY_PROVIDER_FAILURE" : `HTTP_${response.status}`,
        };
        break;
      }

      if (response.status === 204 || !text.trim()) {
        emptyNoContent = emptyNoContent || response.status === 204 || !text.trim();
        chunkOutcomes.push("SUCCESS_WITH_EMPTY_HISTORY");
        batchesSucceeded += 1;
        continue;
      }

      try {
        const articles = parseIndiaPostEventDownloadBody(text);
        collected.push(...articles);
        chunkOutcomes.push(articles.length ? "SUCCESS_WITH_EVENTS" : "SUCCESS_WITH_EMPTY_HISTORY");
        batchesSucceeded += 1;
      } catch {
        batchesFailed += 1;
        chunkOutcomes.push("PARSE_FAILURE");
        hardFailure = { status: 502, code: "TEMPORARY_PROVIDER_FAILURE" };
        break;
      }
    }

    if (hardFailure && collected.length === 0 && hardFailure.status && hardFailure.status !== 400 && hardFailure.status !== 404) {
      return {
        articles: [] as BulkTrackingArticle[],
        chunkOutcomes,
        batchesAttempted,
        batchesSucceeded,
        batchesFailed,
        hardFailure,
        emptyNoContent,
        httpStatus,
      };
    }

    return {
      articles: mergeEventDownloadArticles(collected),
      chunkOutcomes,
      batchesAttempted,
      batchesSucceeded,
      batchesFailed,
      hardFailure,
      emptyNoContent,
      httpStatus,
    };
  }

  private async postEventDownload(token: string, customerId: string, eventDate: string) {
    return fetch(this.sessionUrl("/event/download"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Cust_Id: customerId,
        Event_Code: "LE",
        Event_Date: eventDate,
      }),
      signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.track),
    });
  }

  async cancelShipment() {
    throw new AppError(
      ERROR_CODES.PROVIDER_ERROR,
      "India Post cancel is not supported by the documented CEPT REST APIs."
    );
  }
}

/** Per-process memory of TNT01/TNT02 entitlement denials, keyed by environment and customer ID. */
const trackingApiForbiddenUntil = new Map<string, number>();

type TrackingChunkResult = {
  status: number | null;
  outcome: TrackingChunkOutcome;
  articles?: BulkTrackingArticle[];
  failure?: TrackingHardFailure;
};

export type TrackingFetchResult = {
  articles: BulkTrackingArticle[];
  chunkOutcomes: TrackingChunkOutcome[];
  batchesAttempted: number;
  batchesSucceeded: number;
  batchesFailed: number;
  hardFailure?: TrackingHardFailure;
  emptyNoContent: boolean;
  httpStatus: number | null;
  forbidden?: boolean;
};

function uniqueBarcodes(barcodes: string[]) {
  return [...new Set(barcodes.map((code) => String(code ?? "").trim()).filter(Boolean))];
}

function summarizeTrackingFetch(requested: string[], fetched: TrackingFetchResult) {
  if (fetched.hardFailure && fetched.articles.length === 0) {
    throw hardFailureError(fetched.hardFailure);
  }
  const classified = classifyAcceptedChunk(requested, fetched.articles);
  const tracking = summarizeTrackingSync({
    chunkOutcomes: fetched.chunkOutcomes,
    articles: classified.rows,
    batchesAttempted: fetched.batchesAttempted,
    batchesSucceeded: fetched.batchesSucceeded,
    batchesFailed: fetched.batchesFailed,
    hardFailure: fetched.hardFailure,
  });
  return {
    success: tracking.providerSyncOutcome === "SUCCEEDED" || tracking.providerSyncOutcome === "EMPTY_ACCEPTED",
    data: classified.articles,
    tracking,
    ...(fetched.hardFailure ? { hardFailure: fetched.hardFailure } : {}),
  };
}

/** Test hook: forget cached TNT01/TNT02 403 decisions. */
export function resetIndiaPostTrackingApiForbiddenCache() {
  trackingApiForbiddenUntil.clear();
}

async function readResponseText(response: Response) {
  if (typeof response.text === "function") {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }
  if (typeof response.json === "function") {
    try {
      return JSON.stringify(await response.json());
    } catch {
      return "";
    }
  }
  return "";
}

export function indiaPostFromRow(row: Connection | null) {
  if (!row) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post is not connected.");
  }
  return new IndiaPostProvider(row);
}
