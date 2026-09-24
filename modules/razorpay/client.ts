import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { getRazorpayCredentials } from "@/modules/razorpay/config";

const RAZORPAY_API = "https://api.razorpay.com/v1";

export type RazorpayEntity = Record<string, unknown>;

async function credentials() {
  const { keyId, secret } = await getRazorpayCredentials();
  if (!keyId || !secret) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Razorpay is not configured.");
  }
  return { keyId, secret };
}

async function razorpayRequest<T = RazorpayEntity>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const { keyId, secret } = await credentials();
  const response = await fetch(`${RAZORPAY_API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await response.json().catch(() => ({}))) as RazorpayEntity;
  if (!response.ok) {
    const description =
      (json.error as { description?: string } | undefined)?.description ||
      (typeof json.error === "string" ? json.error : null) ||
      `Razorpay request failed (${response.status}).`;
    logError("razorpay.request_failed", { path, method, status: response.status, description });
    if (response.status === 401) {
      const subscriptionsApi = path.startsWith("/plans") || path.startsWith("/subscriptions");
      throw new AppError(
        ERROR_CODES.INTEGRATION_NOT_CONNECTED,
        subscriptionsApi
          ? "Razorpay Subscriptions is not enabled for these API keys. Enable Subscriptions in the Razorpay Dashboard (Account & Settings → Subscriptions), then try the upgrade again."
          : "Razorpay rejected the API keys. Save the matching Key ID and Key secret in Super Admin → System Settings."
      );
    }
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, description, json);
  }
  return json as T;
}

export async function createRazorpayCustomer(input: { name: string; email?: string | null; contact?: string | null }) {
  return razorpayRequest("POST", "/customers", {
    name: input.name,
    email: input.email || undefined,
    contact: input.contact || undefined,
    fail_existing: 0,
  });
}

export async function createRazorpayPlan(input: {
  period: "monthly" | "yearly";
  name: string;
  amountPaise: number;
  description?: string | null;
}) {
  return razorpayRequest("POST", "/plans", {
    period: input.period,
    interval: 1,
    item: {
      name: input.name,
      amount: input.amountPaise,
      currency: "INR",
      description: input.description || input.name,
    },
  });
}

export async function createRazorpaySubscription(input: {
  planId: string;
  customerId: string;
  totalCount: number;
  notes?: Record<string, string>;
}) {
  return razorpayRequest("POST", "/subscriptions", {
    plan_id: input.planId,
    customer_id: input.customerId,
    total_count: input.totalCount,
    quantity: 1,
    customer_notify: 0,
    notes: input.notes,
  });
}

export async function fetchRazorpaySubscription(id: string) {
  return razorpayRequest("GET", `/subscriptions/${id}`);
}

export async function cancelRazorpaySubscription(id: string, cancelAtCycleEnd = true) {
  return razorpayRequest("POST", `/subscriptions/${id}/cancel`, {
    cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0,
  });
}

export async function pauseRazorpaySubscription(id: string) {
  return razorpayRequest("POST", `/subscriptions/${id}/pause`, { pause_at: "now" });
}

export async function resumeRazorpaySubscription(id: string) {
  return razorpayRequest("POST", `/subscriptions/${id}/resume`, { resume_at: "now" });
}

export async function updateRazorpaySubscription(
  id: string,
  input: { planId: string; scheduleChangeAt: "now" | "cycle_end" }
) {
  return razorpayRequest("PATCH", `/subscriptions/${id}`, {
    plan_id: input.planId,
    schedule_change_at: input.scheduleChangeAt,
  });
}

export async function fetchRazorpayPayment(id: string) {
  return razorpayRequest("GET", `/payments/${id}`);
}

export async function refundRazorpayPayment(id: string, amountPaise?: number) {
  return razorpayRequest("POST", `/payments/${id}/refund`, amountPaise ? { amount: amountPaise } : {});
}

export async function pingRazorpayApi() {
  return razorpayRequest<{ count?: number; items?: RazorpayEntity[] }>("GET", "/customers?count=1");
}

export async function listRazorpayWebhooks() {
  return razorpayRequest<{ items?: RazorpayEntity[]; count?: number }>("GET", "/webhooks");
}

export async function createRazorpayWebhook(input: {
  url: string;
  secret: string;
  events: Record<string, boolean>;
}) {
  return razorpayRequest("POST", "/webhooks", {
    url: input.url,
    secret: input.secret,
    events: input.events,
  });
}

export async function updateRazorpayWebhook(
  id: string,
  input: { url: string; secret?: string; events: Record<string, boolean> }
) {
  const body: Record<string, unknown> = {
    url: input.url,
    events: input.events,
  };
  if (input.secret) body.secret = input.secret;
  return razorpayRequest("PUT", `/webhooks/${id}`, body);
}
