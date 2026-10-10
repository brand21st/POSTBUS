import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { timed } from "@/lib/jobs/timing";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { indiaPostBookingFileUrl, indiaPostBookingUrl, indiaPostOfficesFromPincodeResponse, indiaPostSessionUrl } from "@/modules/india-post/endpoints";
import { indiaPostBookingHasArticleOutcomes, indiaPostFormatBookingFailure, indiaPostJoinMessages } from "@/modules/india-post/error-text";
import { INDIA_POST_TIMEOUT_MS, indiaPostTimeoutSignal } from "@/modules/india-post/http";
import { chunkIds } from "@/modules/india-post/booking-batch";
import { INDIA_POST_TRACKING_BULK_LIMIT } from "@/modules/india-post/spec";
import {
  articlesForRequestedBarcodes,
  parseBulkTrackingResponse,
  retryAfterMsFromHeader,
} from "@/modules/india-post/tracking-response";
import type { ProviderEnvironment } from "@/types/domain";

export type ShippingProvider = {
  validateShipment(input: Record<string, unknown>): Promise<void>;
  getTariff(input: Record<string, unknown>): Promise<unknown>;
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
      const error = new Error(json?.message || "India Post authentication failed.");
      (error as { status?: number; code?: string }).status = response.status;
      (error as { code?: string }).code =
        response.status === 401 ? "PERMANENT_AUTH_ERROR" : `HTTP_${response.status}`;
      throw error;
    }
    const tokens = json.data as {
      access_token: string;
      refresh_token: string;
      id_token: string;
      expires_in: number;
      refresh_expires_in: number;
    };
    this.rememberSession(tokens);
    return tokens;
  }

  private rememberSession(tokens: {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
    refresh_expires_in?: number;
  }) {
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

  private async token() {
    if (
      this.connection.encrypted_access_token &&
      this.connection.expires_at &&
      new Date(this.connection.expires_at).getTime() - Date.now() > 60_000
    ) {
      return decryptSecret(this.connection.encrypted_access_token);
    }
    const tokens = await this.login();
    return tokens.access_token;
  }

  async validateShipment(input: Record<string, unknown>) {
    const pincode = String(input.pincode ?? "");
    if (!/^\d{6}$/.test(pincode)) {
      const error = new Error("Invalid pincode.");
      (error as { code?: string }).code = "INVALID_PINCODE";
      throw error;
    }
    const token = await this.token();
    const response = await fetch(
      `${this.sessionUrl("/pincode-search")}?pincode=${pincode}&office-type=post`,
      { headers: { Authorization: `Bearer ${token}` }, signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.search) }
    );
    if (!response.ok) {
      const error = new Error("Pincode validation failed.");
      (error as { status?: number }).status = response.status;
      throw error;
    }
  }

  async getTariff(input: Record<string, unknown>) {
    const token = await this.token();
    const params = new URLSearchParams({
      "product-code": String(input.productCode ?? "SP"),
      weight: String(input.weight ?? 100),
      "source-pincode": String(input.sourcePincode ?? ""),
      "destination-pincode": String(input.destinationPincode ?? ""),
    });
    const response = await fetch(`${this.sessionUrl("/speed-post/tariffs")}?${params}`, {
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
      this.connection.expires_at &&
      new Date(this.connection.expires_at).getTime() - Date.now() > 60_000
    ) {
      return {
        reused: true as const,
        access_token: decryptSecret(this.connection.encrypted_access_token),
        tokens: null,
      };
    }
    const tokens = await this.login();
    return { reused: false as const, access_token: tokens.access_token, tokens };
  }

  async bookShipment(input: Record<string, unknown>) {
    this.assertConnected();
    const token = await this.token();
    const customId = this.connection.bulk_customer_id;
    if (!customId) {
      throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post customer ID is missing.");
    }
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
  }

  async bookShipmentFile(articles: unknown[]) {
    this.assertConnected();
    const token = await this.token();
    const customId = this.connection.bulk_customer_id;
    if (!customId) {
      throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post customer ID is missing.");
    }
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
    const token = await this.token();
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
    const token = await this.token();
    const articles = Array.isArray(input)
      ? input
      : Array.isArray(input.payload)
        ? input.payload
        : [input.payload ?? input];
    const timeoutMs =
      !Array.isArray(input) && Number(input.timeoutMs) > 0
        ? Number(input.timeoutMs)
        : INDIA_POST_TIMEOUT_MS.label;
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
      }
    );
  }

  async createManifest() {
    throw new AppError(
      ERROR_CODES.PROVIDER_ERROR,
      "India Post has no separate manifest REST endpoint. Booking submits articles."
    );
  }

  async trackShipment(barcodes: string[]) {
    const unique = [...new Set(barcodes.map((code) => String(code ?? "").trim()).filter(Boolean))];
    const token = await this.token();
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
        // Freshly booked articles often 400/403/404 until the first office scan.
        if (response.status === 400 || response.status === 403 || response.status === 404) {
          continue;
        }
        const error = new Error(message);
        (error as { status?: number; code?: string; retryAfterMs?: number }).status = response.status;
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
