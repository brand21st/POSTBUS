import { indiaPostBaseUrl } from "@/lib/env";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { decryptSecret } from "@/lib/security/crypto";
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
  expires_at?: string | null;
  bulk_customer_id?: string | null;
  contract_id?: string | null;
  pickup_dropoff_office_id?: string | null;
  status?: string;
};

export class IndiaPostProvider implements ShippingProvider {
  constructor(private connection: Connection) {}

  private baseUrl() {
    const url = indiaPostBaseUrl(this.connection.environment);
    if (!url) {
      throw new AppError(
        ERROR_CODES.INTEGRATION_NOT_CONNECTED,
        "India Post API base URL is not configured."
      );
    }
    return url.replace(/\/$/, "");
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
    const response = await fetch(`${this.baseUrl()}/access/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.success) {
      const error = new Error(json?.message || "India Post authentication failed.");
      (error as { status?: number; code?: string }).status = response.status;
      (error as { code?: string }).code =
        response.status === 401 ? "PERMANENT_AUTH_ERROR" : `HTTP_${response.status}`;
      throw error;
    }
    return json.data as {
      access_token: string;
      refresh_token: string;
      id_token: string;
      expires_in: number;
      refresh_expires_in: number;
    };
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
      `${this.baseUrl()}/details?pincode=${pincode}&limit=50&office-type=post`,
      { headers: { Authorization: `Bearer ${token}` } }
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
    const response = await fetch(`${this.baseUrl()}/tariffs?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
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

  async bookShipment(input: Record<string, unknown>) {
    this.assertConnected();
    const token = await this.token();
    const customId = this.connection.bulk_customer_id;
    if (!customId) {
      throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post customer ID is missing.");
    }
    const response = await fetch(`${this.baseUrl()}/process-articles/${customId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ articles: input.articles }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.success === false) {
      const error = new Error(json.message || "India Post booking failed.");
      (error as { status?: number }).status = response.status;
      (error as { details?: unknown }).details = json;
      throw error;
    }
    return json;
  }

  async generateLabel(input: Record<string, unknown>) {
    const token = await this.token();
    const response = await fetch(`${this.baseUrl()}/labels`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.payload ?? input),
    });
    if (!response.ok) {
      const error = new Error("India Post label generation failed.");
      (error as { status?: number }).status = response.status;
      throw error;
    }
    return response.arrayBuffer();
  }

  async createManifest() {
    throw new AppError(
      ERROR_CODES.PROVIDER_ERROR,
      "India Post has no separate manifest REST endpoint. Booking submits articles."
    );
  }

  async trackShipment(barcodes: string[]) {
    const token = await this.token();
    const response = await fetch(`${this.baseUrl()}/tracking/bulk`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bulk: barcodes.slice(0, 500) }),
    });
    if (!response.ok) {
      const error = new Error("Tracking lookup failed.");
      (error as { status?: number }).status = response.status;
      throw error;
    }
    return response.json();
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
