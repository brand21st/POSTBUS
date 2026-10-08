import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimOnce, handleWhatsAppStorefrontAction } from "@/modules/orders/whatsapp-lifecycle";
import {
  notifyCustomerPaymentConfirmed,
  notifyCustomerPaymentRejected,
  notifyCustomerPaymentRequired,
  notifyCustomerWhatsAppCancelled,
  notifyCustomerWhatsAppCodAccepted,
  notifyMerchantPaymentClaimed,
  notifyMerchantWhatsAppOrderReady,
} from "@/modules/storefront/order-notify";
import { canFulfillOrder } from "@/lib/dashboard/records";

vi.mock("@/modules/vachat/send", () => ({
  sendVachatSessionText: vi.fn(async () => ({ sent: true })),
}));

vi.mock("@/modules/storefront/order-notify", () => ({
  notifyMerchantWhatsAppOrderReady: vi.fn(async () => {}),
  notifyCustomerWhatsAppCodAccepted: vi.fn(async () => {}),
  notifyCustomerPaymentRequired: vi.fn(async () => {}),
  notifyMerchantPaymentClaimed: vi.fn(async () => {}),
  notifyCustomerPaymentConfirmed: vi.fn(async () => {}),
  notifyCustomerPaymentRejected: vi.fn(async () => {}),
  notifyCustomerWhatsAppCancelled: vi.fn(async () => {}),
}));

const customerOrder = {
  id: "order-1",
  organization_id: "org-1",
  order_number: "PB-11143",
  source: "WHATSAPP",
  status: "IMPORTED",
  payment_status: "PENDING",
  total_amount: 699,
  amount_paid: 0,
  cod_amount: 699,
  metadata: {
    storefront: { paymentPreference: "COD", expectedAdvance: 0, amountOnDelivery: 699, total: 699 },
  },
  customer_id: "cust-1",
  customers: { name: "Rahul", phone: "8848772371" },
  addresses: { line1: "12 ABC", city: "Kozhikode", state: "Kerala", pincode: "673001" },
};

function clientFor(
  order: typeof customerOrder | null,
  opts?: {
    merchantPhone?: string;
    extraOrders?: Array<typeof customerOrder>;
    extraOrgs?: Array<{ id: string; phone: string }>;
    idempotencyError?: { code: string; message: string };
  }
) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Array<{ table: string; row: unknown }> = [];
  const merchantPhone = opts?.merchantPhone ?? "8618456029";
  const idempotency = new Set<string>();
  let current = order ? { ...order, metadata: structuredClone(order.metadata) } : null;
  const extra = opts?.extraOrders ?? [];
  let claims: Array<Record<string, unknown>> = [];
  const orgs = [{ id: "org-1", phone: merchantPhone }, ...(opts?.extraOrgs ?? [])];
  const api = {
    updates,
    inserts,
    claims: () => claims,
    current: () => current,
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "cas_whatsapp_customer_confirm") {
        const meta = (current?.metadata ?? {}) as { whatsappLifecycle?: { customer_confirmed_at?: string }; storefront?: { customer_confirmed_at?: string } };
        if (!current || meta.whatsappLifecycle?.customer_confirmed_at || meta.storefront?.customer_confirmed_at) {
          return { data: null, error: null };
        }
        const nextMeta = args.p_metadata;
        updates.push({ metadata: nextMeta });
        current = { ...current, metadata: nextMeta as typeof current.metadata };
        return {
          data: {
            id: current.id,
            order_number: current.order_number,
            status: current.status,
            payment_status: current.payment_status,
            metadata: current.metadata,
          },
          error: null,
        };
      }
      if (name === "resolve_whatsapp_payment_claim") {
        if (!current) return { data: { result: "not_found" }, error: null };
        if (current.status === "CANCELLED") return { data: { result: "cancelled" }, error: null };
        if (args.p_action === "CONFIRM") {
          if (current.status === "READY") return { data: { result: "already_confirmed" }, error: null };
          const open = claims.find((claim) => claim.status === "OPEN");
          if (!open) return { data: { result: "no_open_claim" }, error: null };
          if (current.status !== "IMPORTED" || current.payment_status !== "PENDING") {
            return { data: { result: "invalid_state" }, error: null };
          }
          const patch = {
            status: "READY",
            payment_status: args.p_payment_status,
            amount_paid: args.p_amount_paid,
            cod_amount: args.p_cod_amount,
            metadata: args.p_metadata,
          };
          updates.push(patch);
          current = { ...current, ...patch } as typeof current;
          open.status = "CONFIRMED";
          return { data: { result: "confirmed", claim_id: open.id }, error: null };
        }
        if (current.status === "READY") return { data: { result: "already_confirmed" }, error: null };
        const open = claims.find((claim) => claim.status === "OPEN");
        if (!open) return { data: { result: "no_open_claim" }, error: null };
        open.status = "REJECTED";
        return { data: { result: "rejected", claim_id: open.id }, error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      const filters: Record<string, string> = {};
      const query: Record<string, unknown> = {};
      const self = () => query;
      query.select = self;
      query.eq = (column: string, value: string) => {
        filters[column] = value;
        return query;
      };
      query.not = self;
      query.or = self;
      query.insert = (row: unknown) => {
        inserts.push({ table, row });
        if (table === "idempotency_keys") {
          const key = String((row as { key?: string }).key ?? "");
          if (opts?.idempotencyError) {
            query.insertError = opts.idempotencyError;
          } else if (idempotency.has(key)) {
            query.insertError = { code: "23505", message: "duplicate" };
          } else {
            idempotency.add(key);
          }
        }
        if (table === "order_payment_claims") {
          const rowObj = row as Record<string, unknown>;
          if (claims.some((claim) => claim.status === "OPEN")) {
            query.insertError = { code: "23505", message: "duplicate" };
          } else {
            claims.push({ id: "claim-1", status: "OPEN", ...rowObj });
          }
        }
        return query;
      };
      query.update = (row: unknown) => {
        updates.push(row as Record<string, unknown>);
        query.pendingUpdate = row;
        if (current && table === "orders") {
          current = { ...current, ...(row as object) };
        }
        return query;
      };
      query.maybeSingle = async () => {
        if (table === "idempotency_keys") {
          return { data: null, error: (query as { insertError?: unknown }).insertError ?? null };
        }
        if (table === "organizations") {
          return { data: { id: orgs[0]?.id, phone: orgs[0]?.phone, name: "Priya" }, error: null };
        }
        if (table === "storefront_settings") {
          return { data: { store_name: "Priya", upi_id: "priya@upi", gpay_number: "8618456029" }, error: null };
        }
        if (table === "order_payment_claims") {
          const pending = (query as { pendingUpdate?: Record<string, unknown> }).pendingUpdate;
          const match = claims.find((claim) => !filters.status || claim.status === filters.status);
          if (pending && match) Object.assign(match, pending);
          return { data: match ?? null, error: (query as { insertError?: unknown }).insertError ?? null };
        }
        if (table === "orders" && updates.length) {
          if (filters.source && filters.source !== "WHATSAPP") return { data: null, error: null };
          if (current && filters.status && filters.status !== current.status && updates.length === 0) {
            return { data: null, error: null };
          }
          return { data: current, error: null };
        }
        return { data: null, error: null };
      };
      query.single = async () => {
        if ((query as { insertError?: { code?: string; message?: string } }).insertError) {
          return { data: null, error: (query as { insertError?: unknown }).insertError };
        }
        return { data: { id: table === "order_payment_claims" ? "claim-1" : "id-1" }, error: null };
      };
      query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (table === "idempotency_keys") {
          return Promise.resolve({
            data: null,
            error: (query as { insertError?: unknown }).insertError ?? null,
          }).then(resolve, reject);
        }
        if (table === "order_payment_claims") {
          const pending = (query as { pendingUpdate?: Record<string, unknown> }).pendingUpdate;
          if (pending) {
            for (const claim of claims) {
              if (!filters.status || claim.status === filters.status) Object.assign(claim, pending);
            }
          }
          return Promise.resolve({ data: claims, error: null }).then(resolve, reject);
        }
        if (table === "orders") {
          const rows = [current, ...extra].filter(Boolean) as Array<typeof customerOrder>;
          const matched = rows.filter((row) => {
            if (filters.source && row.source !== filters.source) return false;
            if (filters.order_number && row.order_number !== filters.order_number) return false;
            return true;
          });
          return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
        }
        if (table === "organizations") {
          const digits = merchantPhone;
          const matched = orgs.filter((row) => row.phone === digits || row.phone.endsWith(digits));
          return Promise.resolve({ data: matched.length ? matched : orgs, error: null }).then(resolve, reject);
        }
        if (table === "order_line_items") {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      };
      return query;
    },
  };
  return api;
}

describe("WhatsApp storefront Phase 1 lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets the customer confirm a valid PB order without marking READY or PAID", async () => {
    const supabase = clientFor(customerOrder);
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "YES PB-11143",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toContain("PB-11143");
    expect(result.reply).not.toContain("PAYMENT CONFIRMED");
    expect(supabase.updates[0]).toMatchObject({
      metadata: expect.objectContaining({
        storefront: expect.objectContaining({ customer_confirmed_at: expect.any(String) }),
        whatsappLifecycle: expect.objectContaining({ customer_confirmed_via: "whatsapp" }),
      }),
    });
    expect(supabase.updates[0]).not.toMatchObject({ status: "READY" });
    expect(supabase.updates[0]).not.toMatchObject({ payment_status: "PAID" });
    expect(supabase.updates[0]).not.toHaveProperty("status");
    expect(notifyMerchantWhatsAppOrderReady).toHaveBeenCalledTimes(1);
  });

  it("cancels the same order on customer NO and does not notify the merchant to process", async () => {
    const supabase = clientFor(customerOrder);
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "NO PB-11143",
    });
    expect(result.reply).toContain("ORDER CANCELLED");
    expect(supabase.updates[0]).toMatchObject({ status: "CANCELLED" });
    expect(notifyMerchantWhatsAppOrderReady).not.toHaveBeenCalled();
  });

  it("rejects a different customer YES", async () => {
    const supabase = clientFor(customerOrder);
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+919999999999",
      text: "YES PB-11143",
    });
    expect(result.reply).toContain("could not match");
    expect(supabase.updates).toHaveLength(0);
    expect(notifyMerchantWhatsAppOrderReady).not.toHaveBeenCalled();
  });

  it("rejects a different customer NO", async () => {
    const supabase = clientFor(customerOrder);
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+919999999999",
      text: "NO PB-11143",
    });
    expect(result.reply).toContain("could not match");
    expect(supabase.updates).toHaveLength(0);
  });

  it("rejects the wrong PB order", async () => {
    const supabase = clientFor(customerOrder);
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "YES PB-99999",
    });
    expect(result.reply).toContain("could not match");
    expect(supabase.updates).toHaveLength(0);
  });

  it("is idempotent for duplicate YES and does not send a second merchant NEW ORDER", async () => {
    const supabase = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" });
    const second = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "YES PB-11143",
    });
    expect(second.reply).toContain("already confirmed");
    expect(notifyMerchantWhatsAppOrderReady).toHaveBeenCalledTimes(1);
    expect(supabase.updates.filter((row) => "metadata" in row)).toHaveLength(1);
  });

  it("is idempotent for duplicate NO", async () => {
    const supabase = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "NO PB-11143" });
    const second = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "NO PB-11143",
    });
    expect(second.reply).toContain("ORDER CANCELLED");
    expect(supabase.updates.filter((row) => row.status === "CANCELLED")).toHaveLength(1);
  });

  it("does not confirm after NO", async () => {
    const supabase = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "NO PB-11143" });
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "YES PB-11143",
    });
    expect(result.reply).toContain("already cancelled");
    expect(notifyMerchantWhatsAppOrderReady).not.toHaveBeenCalled();
  });

  it("does not cancel after YES", async () => {
    const supabase = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" });
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "NO PB-11143",
    });
    expect(result.reply).toContain("already confirmed");
    expect(supabase.current()?.status).toBe("IMPORTED");
  });

  it("does not process before customer confirmation", async () => {
    const supabase = clientFor(customerOrder);
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "PROCESS PB-11143",
    });
    expect(result.reply).toContain("has not confirmed");
    expect(supabase.updates).toHaveLength(0);
  });

  it("does not let the merchant CANCEL before customer YES", async () => {
    const supabase = clientFor(customerOrder);
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "CANCEL PB-11143",
    });
    expect(result.reply).toContain("has not confirmed");
    expect(supabase.updates).toHaveLength(0);
  });

  it("marks COD with ₹0 advance READY after merchant PROCESS", async () => {
    const supabase = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" });
    expect(notifyMerchantWhatsAppOrderReady).toHaveBeenCalledTimes(1);
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "PROCESS PB-11143",
    });
    expect(result.reply).toContain("READY");
    expect(supabase.current()).toMatchObject({ status: "READY", payment_status: "COD", amount_paid: 0 });
    expect(supabase.current()?.payment_status).not.toBe("PAID");
    expect(notifyCustomerWhatsAppCodAccepted).toHaveBeenCalledTimes(1);
    expect(notifyCustomerPaymentRequired).not.toHaveBeenCalled();
    expect(supabase.inserts.filter((row) => row.table === "orders" || row.table === "shipments")).toHaveLength(0);
    expect(canFulfillOrder({ status: "READY", source: "WHATSAPP" })).toBe(true);
  });

  it("keeps advance/prepaid orders not READY and not PAID after PROCESS", async () => {
    const advanceOrder = {
      ...customerOrder,
      metadata: {
        storefront: { paymentPreference: "COD", expectedAdvance: 500, amountOnDelivery: 1500, total: 2000 },
      },
      total_amount: 2000,
      cod_amount: 1500,
    };
    const supabase = clientFor(advanceOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" });
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "PROCESS PB-11143",
    });
    expect(result.reply).toContain("Payment");
    expect(supabase.current()?.status).toBe("IMPORTED");
    expect(supabase.current()?.payment_status).toBe("PENDING");
    expect(supabase.current()?.metadata).toMatchObject({
      whatsappLifecycle: expect.objectContaining({
        payment_required: true,
        payment_required_amount: 500,
        merchant_processed_at: expect.any(String),
      }),
    });
    expect(notifyCustomerPaymentRequired).toHaveBeenCalledTimes(1);
    expect(supabase.inserts.filter((row) => row.table === "shipments")).toHaveLength(0);
    expect(canFulfillOrder({ status: supabase.current()?.status, source: "WHATSAPP" })).toBe(false);
  });

  it("keeps prepaid PROCESS not READY and not PAID", async () => {
    const prepaid = {
      ...customerOrder,
      metadata: {
        storefront: { paymentPreference: "PREPAID", expectedAdvance: 0, amountOnDelivery: 0, total: 2000 },
      },
      total_amount: 2000,
      cod_amount: 0,
    };
    const supabase = clientFor(prepaid);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" });
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "PROCESS PB-11143",
    });
    expect(result.reply).toContain("2000");
    expect(supabase.current()).toMatchObject({ status: "IMPORTED", payment_status: "PENDING" });
  });

  it("lets the merchant CANCEL after customer YES", async () => {
    const supabase = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" });
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "CANCEL PB-11143",
    });
    expect(supabase.current()?.status).toBe("CANCELLED");
    expect(result.reply).toContain("rejected");
    expect(notifyCustomerWhatsAppCancelled).toHaveBeenCalledTimes(1);
    expect(notifyMerchantWhatsAppOrderReady).toHaveBeenCalledTimes(1);
  });

  it("is idempotent for duplicate PROCESS on COD", async () => {
    const supabase = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" });
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918618456029", text: "PROCESS PB-11143" });
    const second = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "PROCESS PB-11143",
    });
    expect(second.reply).toContain("already processing");
    expect(supabase.updates.filter((row) => row.status === "READY")).toHaveLength(1);
    expect(notifyCustomerWhatsAppCodAccepted).toHaveBeenCalledTimes(1);
  });

  it("is idempotent for duplicate PROCESS when payment is required", async () => {
    const advanceOrder = {
      ...customerOrder,
      metadata: {
        storefront: { paymentPreference: "COD", expectedAdvance: 500, amountOnDelivery: 1500, total: 2000 },
      },
      total_amount: 2000,
    };
    const supabase = clientFor(advanceOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" });
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918618456029", text: "PROCESS PB-11143" });
    const second = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "PROCESS PB-11143",
    });
    expect(second.reply).toContain("already accepted");
    expect(notifyCustomerPaymentRequired).toHaveBeenCalledTimes(1);
    expect(supabase.current()?.status).toBe("IMPORTED");
  });

  it("is idempotent for duplicate merchant CANCEL", async () => {
    const supabase = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" });
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918618456029", text: "CANCEL PB-11143" });
    const second = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "CANCEL PB-11143",
    });
    expect(second.reply).toContain("cancelled");
    expect(supabase.updates.filter((row) => row.status === "CANCELLED")).toHaveLength(1);
    expect(notifyCustomerWhatsAppCancelled).toHaveBeenCalledTimes(1);
  });

  it("rejects PROCESS after CANCEL", async () => {
    const supabase = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" });
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918618456029", text: "CANCEL PB-11143" });
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "PROCESS PB-11143",
    });
    expect(result.reply).toContain("cancelled");
    expect(supabase.current()?.status).toBe("CANCELLED");
  });

  it("ignores PROCESS on Manual and Shopify orders", async () => {
    for (const source of ["MANUAL", "SHOPIFY"] as const) {
      const supabase = clientFor({ ...customerOrder, source, status: source === "MANUAL" ? "READY" : "IMPORTED" });
      const result = await handleWhatsAppStorefrontAction(supabase as never, {
        from: "+918618456029",
        text: "PROCESS PB-11143",
      });
      expect(result.reply).toContain("could not match");
      expect(supabase.updates).toHaveLength(0);
    }
  });

  it("rejects PROCESS for the wrong PB number", async () => {
    const supabase = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" });
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "PROCESS PB-99999",
    });
    expect(result.reply).toContain("could not match");
  });

  it("notifies the merchant only after customer YES", async () => {
    const supabase = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "NO PB-11143" });
    expect(notifyMerchantWhatsAppOrderReady).not.toHaveBeenCalled();
    const yesClient = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(yesClient as never, { from: "+918848772371", text: "YES PB-11143" });
    expect(notifyMerchantWhatsAppOrderReady).toHaveBeenCalledTimes(1);
  });

  it("ignores Manual, Shopify, and WooCommerce orders", async () => {
    for (const source of ["MANUAL", "SHOPIFY", "WOOCOMMERCE"] as const) {
      const supabase = clientFor({ ...customerOrder, source });
      const result = await handleWhatsAppStorefrontAction(supabase as never, {
        from: "+918848772371",
        text: "YES PB-11143",
      });
      expect(result.reply).toContain("could not match");
      expect(supabase.updates).toHaveLength(0);
    }
  });

  it("does not create another order on YES or NO", async () => {
    const yesClient = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(yesClient as never, { from: "+918848772371", text: "YES PB-11143" });
    expect(yesClient.inserts.filter((row) => row.table === "orders")).toHaveLength(0);
    const noClient = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(noClient as never, { from: "+918848772371", text: "NO PB-11143" });
    expect(noClient.inserts.filter((row) => row.table === "orders")).toHaveLength(0);
  });

  it("requires WhatsApp source even when the phone matches", async () => {
    const supabase = clientFor({ ...customerOrder, source: "MANUAL", status: "READY", payment_status: "PAID" });
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "YES PB-11143",
    });
    expect(result.reply).toContain("could not match");
  });

  it("blocks a merchant from another tenant", async () => {
    const supabase = clientFor(customerOrder, { merchantPhone: "9000000001" });
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "PROCESS PB-11143",
    });
    expect(result.reply).toContain("could not match");
    expect(supabase.updates).toHaveLength(0);
  });
});

const advanceOrder = {
  ...customerOrder,
  total_amount: 2000,
  cod_amount: 1500,
  metadata: {
    storefront: { paymentPreference: "COD", expectedAdvance: 500, amountOnDelivery: 1500, total: 2000 },
  },
};

describe("WhatsApp storefront Phase 3 payment claims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function processed(order = advanceOrder) {
    const supabase = clientFor(order);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" });
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918618456029", text: "PROCESS PB-11143" });
    return supabase;
  }

  it("sends the stored rupee amount and org UPI after PROCESS", async () => {
    const supabase = await processed();
    expect(notifyCustomerPaymentRequired).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      "8848772371",
      expect.objectContaining({ orderNumber: "PB-11143", amount: 500, upiId: "priya@upi" }),
      "order-1"
    );
    expect(supabase.current()?.status).toBe("IMPORTED");
  });

  it("creates one OPEN claim on I HAVE PAID without marking PAID or READY", async () => {
    const supabase = await processed();
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "I HAVE PAID PB-11143",
    });
    expect(result.reply).toContain("PAYMENT SUBMITTED");
    expect(supabase.claims()).toHaveLength(1);
    expect(supabase.claims()[0]).toMatchObject({ status: "OPEN", amount: 500, organization_id: "org-1" });
    expect(supabase.current()).toMatchObject({ status: "IMPORTED", payment_status: "PENDING" });
    expect(notifyMerchantPaymentClaimed).toHaveBeenCalledTimes(1);
  });

  it("does not create a second OPEN claim on duplicate I HAVE PAID", async () => {
    const supabase = await processed();
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "I HAVE PAID PB-11143" });
    const second = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "I HAVE PAID PB-11143",
    });
    expect(second.reply).toContain("ALREADY SUBMITTED");
    expect(supabase.claims().filter((claim) => claim.status === "OPEN")).toHaveLength(1);
    expect(notifyMerchantPaymentClaimed).toHaveBeenCalledTimes(1);
  });

  it("rejects claims from the wrong customer, Manual, Shopify, and cancelled orders", async () => {
    const supabase = await processed();
    const wrong = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+919999999999",
      text: "I HAVE PAID PB-11143",
    });
    expect(wrong.reply).toContain("could not match");

    for (const source of ["MANUAL", "SHOPIFY"] as const) {
      const isolated = clientFor({ ...advanceOrder, source });
      const result = await handleWhatsAppStorefrontAction(isolated as never, {
        from: "+918848772371",
        text: "I HAVE PAID PB-11143",
      });
      expect(result.reply).toContain("could not match");
    }

    const cancelled = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(cancelled as never, { from: "+918848772371", text: "NO PB-11143" });
    const afterCancel = await handleWhatsAppStorefrontAction(cancelled as never, {
      from: "+918848772371",
      text: "I HAVE PAID PB-11143",
    });
    expect(afterCancel.reply).toMatch(/cancelled|not waiting/i);
  });

  it("rejects I HAVE PAID before merchant PROCESS and for COD with no payment required", async () => {
    const unprocessed = clientFor(advanceOrder);
    await handleWhatsAppStorefrontAction(unprocessed as never, { from: "+918848772371", text: "YES PB-11143" });
    const tooSoon = await handleWhatsAppStorefrontAction(unprocessed as never, {
      from: "+918848772371",
      text: "I HAVE PAID PB-11143",
    });
    expect(tooSoon.reply).toContain("not waiting");

    const cod = clientFor(customerOrder);
    await handleWhatsAppStorefrontAction(cod as never, { from: "+918848772371", text: "YES PB-11143" });
    await handleWhatsAppStorefrontAction(cod as never, { from: "+918618456029", text: "PROCESS PB-11143" });
    const afterCod = await handleWhatsAppStorefrontAction(cod as never, {
      from: "+918848772371",
      text: "I HAVE PAID PB-11143",
    });
    expect(afterCod.reply).toMatch(/already paid|does not require/i);
  });

  it("settles through settleOrderPayment and marks READY only after merchant CONFIRM PAYMENT", async () => {
    const supabase = await processed();
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "I HAVE PAID PB-11143" });
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "CONFIRM PAYMENT PB-11143",
    });
    expect(result.reply).toContain("READY");
    expect(supabase.current()).toMatchObject({
      status: "READY",
      payment_status: "PARTIAL",
      amount_paid: 500,
      cod_amount: 1500,
    });
    expect(supabase.claims()[0]?.status).toBe("CONFIRMED");
    expect(notifyCustomerPaymentConfirmed).toHaveBeenCalledTimes(1);
    expect(canFulfillOrder({ status: "READY", source: "WHATSAPP" })).toBe(true);
  });

  it("settles prepaid as PAID after merchant confirmation", async () => {
    const prepaid = {
      ...customerOrder,
      total_amount: 2000,
      metadata: {
        storefront: { paymentPreference: "PREPAID", expectedAdvance: 0, amountOnDelivery: 0, total: 2000 },
      },
    };
    const supabase = await processed(prepaid);
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "I HAVE PAID PB-11143" });
    await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "CONFIRM PAYMENT PB-11143",
    });
    expect(supabase.current()).toMatchObject({ status: "READY", payment_status: "PAID", amount_paid: 2000, cod_amount: 0 });
  });

  it("does not settle twice on duplicate CONFIRM PAYMENT", async () => {
    const supabase = await processed();
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "I HAVE PAID PB-11143" });
    await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "CONFIRM PAYMENT PB-11143",
    });
    const second = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "CONFIRM PAYMENT PB-11143",
    });
    expect(second.reply).toMatch(/already verified|READY/i);
    expect(supabase.updates.filter((row) => row.status === "READY")).toHaveLength(1);
  });

  it("rejects confirmation from the wrong merchant, wrong PB, or without an OPEN claim", async () => {
    const supabase = await processed();
    const noClaim = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "CONFIRM PAYMENT PB-11143",
    });
    expect(noClaim.reply).toContain("No open payment claim");

    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "I HAVE PAID PB-11143" });
    const wrongPb = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "CONFIRM PAYMENT PB-99999",
    });
    expect(wrongPb.reply).toContain("could not match");

    const otherMerchant = await processed();
    await handleWhatsAppStorefrontAction(otherMerchant as never, {
      from: "+918848772371",
      text: "I HAVE PAID PB-11143",
    });
    const wrongMerchant = clientFor(otherMerchant.current() as typeof customerOrder, { merchantPhone: "9000000001" });
    const result = await handleWhatsAppStorefrontAction(wrongMerchant as never, {
      from: "+918618456029",
      text: "CONFIRM PAYMENT PB-11143",
    });
    expect(result.reply).toContain("could not match");
  });

  it("rejects payment without READY or PAID and allows a retry claim", async () => {
    const supabase = await processed();
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "I HAVE PAID PB-11143" });
    const rejected = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "REJECT PAYMENT PB-11143",
    });
    expect(rejected.reply).toContain("not verified");
    expect(supabase.current()).toMatchObject({ status: "IMPORTED", payment_status: "PENDING" });
    expect(supabase.claims()[0]?.status).toBe("REJECTED");
    expect(notifyCustomerPaymentRejected).toHaveBeenCalledTimes(1);

    const retry = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "I HAVE PAID PB-11143",
    });
    expect(retry.reply).toContain("PAYMENT SUBMITTED");
    expect(supabase.claims().filter((claim) => claim.status === "OPEN")).toHaveLength(1);

    const dupReject = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "REJECT PAYMENT PB-11143",
    });
    expect(dupReject.reply).toMatch(/not verified|No open/i);
  });

  it("does not confirm a REJECTED claim", async () => {
    const supabase = await processed();
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "I HAVE PAID PB-11143" });
    await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "REJECT PAYMENT PB-11143",
    });
    const confirm = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "CONFIRM PAYMENT PB-11143",
    });
    expect(confirm.reply).toContain("No open payment claim");
    expect(supabase.current()?.status).toBe("IMPORTED");
  });

  it("cannot produce READY + REJECTED when CONFIRM and REJECT race", async () => {
    const supabase = await processed();
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "I HAVE PAID PB-11143" });
    const [confirm, reject] = await Promise.all([
      handleWhatsAppStorefrontAction(supabase as never, { from: "+918618456029", text: "CONFIRM PAYMENT PB-11143" }),
      handleWhatsAppStorefrontAction(supabase as never, { from: "+918618456029", text: "REJECT PAYMENT PB-11143" }),
    ]);
    expect(confirm.handled || reject.handled).toBe(true);
    const claimStatus = supabase.claims()[0]?.status;
    if (supabase.current()?.status === "READY") {
      expect(claimStatus).not.toBe("REJECTED");
      expect(claimStatus).toBe("CONFIRMED");
    } else {
      expect(supabase.current()?.status).toBe("IMPORTED");
      expect(claimStatus).not.toBe("CONFIRMED");
    }
  });

  it("leaves the claim OPEN when settlement fails", async () => {
    const supabase = await processed();
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "I HAVE PAID PB-11143" });
    const current = supabase.current() as typeof customerOrder;
    (current.metadata as { storefront: { expectedAdvance: number } }).storefront.expectedAdvance = 0;
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "CONFIRM PAYMENT PB-11143",
    });
    expect(result.reply).toMatch(/Could not settle|Try again/i);
    expect(supabase.current()?.status).toBe("IMPORTED");
    expect(supabase.claims()[0]?.status).toBe("OPEN");
  });

  it("confirms only one concurrent YES and notifies the merchant once", async () => {
    const supabase = clientFor(customerOrder);
    const [first, second] = await Promise.all([
      handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" }),
      handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" }),
    ]);
    expect([first.reply, second.reply].some((reply) => reply?.includes("already confirmed"))).toBe(true);
    expect(notifyMerchantWhatsAppOrderReady).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the same PB exists for two orgs sharing a merchant phone", async () => {
    const supabase = clientFor(customerOrder, {
      extraOrders: [{ ...customerOrder, id: "order-2", organization_id: "org-2" }],
      extraOrgs: [{ id: "org-2", phone: "8618456029" }],
    });
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "PROCESS PB-11143",
    });
    expect(result.reply).toContain("could not match");
    expect(supabase.updates).toHaveLength(0);
  });

  it("fails closed when the same customer phone matches two WhatsApp PBs across tenants", async () => {
    const supabase = clientFor(customerOrder, {
      extraOrders: [{ ...customerOrder, id: "order-2", organization_id: "org-2" }],
    });
    const result = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "YES PB-11143",
    });
    expect(result.reply).toContain("could not match");
    expect(supabase.updates).toHaveLength(0);
  });

  it("closes an OPEN claim when the order is cancelled and blocks later CONFIRM", async () => {
    const supabase = await processed();
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "I HAVE PAID PB-11143" });
    expect(supabase.claims()[0]?.status).toBe("OPEN");
    await handleWhatsAppStorefrontAction(supabase as never, { from: "+918618456029", text: "CANCEL PB-11143" });
    expect(supabase.current()?.status).toBe("CANCELLED");
    expect(supabase.claims()[0]?.status).toBe("REJECTED");
    const paid = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918848772371",
      text: "I HAVE PAID PB-11143",
    });
    expect(paid.reply).toMatch(/cancelled/i);
    const confirm = await handleWhatsAppStorefrontAction(supabase as never, {
      from: "+918618456029",
      text: "CONFIRM PAYMENT PB-11143",
    });
    expect(confirm.reply).toMatch(/cancelled|already verified|No open/i);
    expect(supabase.current()?.status).toBe("CANCELLED");
  });

  it("propagates unexpected claimOnce database errors", async () => {
    const supabase = clientFor(customerOrder, { idempotencyError: { code: "42501", message: "permission denied" } });
    await expect(
      handleWhatsAppStorefrontAction(supabase as never, { from: "+918848772371", text: "YES PB-11143" })
    ).rejects.toThrow(/permission denied/);
    await expect(claimOnce(supabase as never, "org-1", "k")).rejects.toThrow(/permission denied/);
  });
});


