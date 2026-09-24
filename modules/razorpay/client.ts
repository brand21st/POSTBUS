import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { logError } from "@/lib/logger";

const RAZORPAY_API = "https://api.razorpay.com/v1";

export type RazorpayEntity = Record<string, unknown>;

function credentials() {
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "Razorpay is not configured.");
  }
  return { keyId: env.razorpayKeyId, secret: env.razorpayKeySecret };
}

async function razorpayRequest<T = RazorpayEntity>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const { keyId, secret } = credentials();
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
