import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret } from "@/lib/security/crypto";
import { tariffInputSchema, tariffRequest, normalizeTariff, usableTariffDraft, type TariffInput } from "./tariff-contract";
import { executeTariff, resolveTariffInput, saveTariffEstimate, tariffSession, tariffOrderDefaults, loadTariffOrder, type TariffConnection } from "./tariff";

const input: TariffInput = { service: "BUSINESS_PARCEL", sourcePincode: "400001", destinationPincode: "110001", weightGrams: 550, lengthCm: 20, widthCm: 15, heightCm: 10 };
const response = { success: true, currency: "INR", base_tariff: 70, final_amount: 152, vas_charges: { INSVAL: 58 }, total_tax: 24 };
function database(overrides: Partial<TariffConnection> = {}, failWrite = false) {
  const connection: TariffConnection = { id: "connection-1", organization_id: "org-1", environment: "UAT", status: "CONNECTED", encrypted_username: encryptSecret("test-user"), encrypted_password: encryptSecret("test-password"), pickup_office_pincode: "400001", encrypted_access_token: encryptSecret("cached-token"), expires_at: new Date(Date.now() + 3600000).toISOString(), ...overrides };
  const operations: Array<{ table: string; update?: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const db = { from(table: string) {
    const op: typeof operations[number] = { table, filters: [] }; operations.push(op);
    const chain = {
      select: () => chain, eq: (key: string, value: unknown) => { op.filters.push([key, value]); return chain; },
      update: (value: Record<string, unknown>) => { op.update = value; return chain; },
      maybeSingle: async () => {
        if (op.update) { if (failWrite) return { data: null, error: { message: "secret database details" } }; Object.assign(connection, op.update); return { data: { id: connection.id }, error: null }; }
        return { data: table === "orders" ? null : { ...connection }, error: null };
      },
    }; return chain;
  } } as unknown as SupabaseClient;
  return { db, operations, connection };
}
afterEach(() => vi.unstubAllGlobals());

describe("tariff contract", () => {
  it("does not let blank draft values replace valid defaults", () => {
    expect({ weightGrams: 750, lengthCm: 20, ...usableTariffDraft({ weightGrams: 0, lengthCm: undefined, widthCm: 15 }) }).toEqual({
      weightGrams: 750,
      lengthCm: 20,
      widthCm: 15,
    });
  });
  it("uses BP and lowercase ins without COD or POD", () => {
    const path = tariffRequest({ ...input, insuranceValue: 1000 });
    expect(path).toContain("/business-parcel-tariff/calculate?");
    const params = new URL(path, "https://example.test").searchParams;
    expect(Object.fromEntries(params)).toEqual({ "product-code": "BP", weight: "550", "source-pincode": "400001", "destination-pincode": "110001", length: "20", width: "15", height: "10", ins: "1000" });
  });
  it("uses SP with uppercase INS and POD", () => {
    const path = tariffRequest({ ...input, service: "SP_INLAND_PARCEL", insuranceValue: 1000, proofOfDelivery: true });
    expect(path).toContain("/speed-post/tariffs?product-code=SP"); expect(path).toContain("INS=1000&POD=YES");
  });
  it("omits optional services", () => { expect(tariffRequest(input)).not.toMatch(/ins|INS|POD|COD/); });
  it.each([0, -1, 1.5, NaN, Infinity, 35001])("rejects invalid weight %s", (weightGrams) => expect(tariffInputSchema.safeParse({ ...input, weightGrams }).success).toBe(false));
  it.each([{}, { lengthCm: 0 }, { widthCm: 8 }, { heightCm: 151 }, { destinationPincode: "abc" }, { service: "EXPRESS" }, { proofOfDelivery: true }, { insuranceValue: -1 }])("rejects missing or invalid inputs %j", (patch) => expect(tariffInputSchema.safeParse(Object.keys(patch).length ? { ...input, ...patch } : {}).success).toBe(false));
  it("blocks light SP parcels including 500 g while allowing documents", () => {
    expect(tariffInputSchema.safeParse({ ...input, service: "SP_INLAND_PARCEL", weightGrams: 500 }).success).toBe(false);
    expect(tariffInputSchema.safeParse({ ...input, service: "SP_INLAND_DOC", weightGrams: 500, lengthCm: 42, widthCm: 29, heightCm: 2 }).success).toBe(true);
    expect(tariffInputSchema.safeParse({ ...input, service: "SP_INLAND_DOC", weightGrams: 501, heightCm: 1 }).success).toBe(false);
  });
  it("preserves provider total and object VAS without summation", () => {
    const quote = normalizeTariff({ ...response, access_token: "must-not-escape" }, input);
    expect(quote.estimatedTotal).toBe(152); expect(quote.vasCharges).toEqual({ INSVAL: 58 }); expect(quote.codCharges).toBeNull(); expect(JSON.stringify(quote)).not.toContain("must-not-escape");
  });
  it("supports scalar VAS and absent optional charges", () => { expect(normalizeTariff({ ...response, vas_charges: 58 }, input).vasCharges).toBe(58); expect(normalizeTariff({ success: true, currency: "INR", base_tariff: 0, final_amount: 0 }, input).vasCharges).toBeNull(); });
  it.each([{ success: false }, { final_amount: undefined }, { final_amount: -1 }, { final_amount: Infinity }, { final_amount: "152" }, { currency: "USD" }, { vas_charges: { INSVAL: -1 } }, { cgst: "12" }, { base_tariff: NaN }])("rejects invalid provider response %j", (patch) => expect(() => normalizeTariff({ ...response, ...patch }, input)).toThrow());
});

describe("tenant and read-only input resolution", () => {
  it("rejects extra tenant and credential fields", () => {
    const { connection } = database();
    const manual = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "sourcePincode"));
    for (const key of ["organization_id", "access_token", "url", "environment", "sourcePincode"]) expect(() => resolveTariffInput({ ...manual, [key]: "other" }, connection)).toThrow();
  });
  it("requires sender choice when configured pincodes differ", () => {
    const { connection } = database({ pickup_dropoff_office_pincode: "600001" });
    const manual = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "sourcePincode"));
    expect(() => resolveTariffInput(manual, connection)).toThrow("Choose");
    expect(resolveTariffInput({ ...manual, senderOffice: "dropoff" }, connection).sourcePincode).toBe("600001");
  });
  it("does not invent dimensions or partial line-item weight", () => {
    const { connection } = database();
    const order = { shipping_address: { pincode: "110001" }, order_line_items: [{ weight_grams: 100, quantity: 1 }, { weight_grams: null, quantity: 1 }], shipments: [] };
    expect(tariffOrderDefaults(order, connection).weightGrams).toBeUndefined();
    expect(tariffOrderDefaults(order, connection).lengthCm).toBeUndefined();
    expect(() => resolveTariffInput({}, connection, order)).toThrow();
    const temporary = Object.fromEntries(Object.entries(input).filter(([key]) => !["sourcePincode", "destinationPincode"].includes(key)));
    expect(resolveTariffInput(temporary, connection, order).weightGrams).toBe(550);
    expect(order.shipments).toEqual([]);
  });
  it("filters order lookup by tenant and returns not found", async () => {
    const { db, operations } = database();
    await expect(loadTariffOrder(db, "org-1", "00000000-0000-4000-8000-000000000001")).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(operations[0].filters).toContainEqual(["organization_id", "org-1"]);
  });
  it("stores only the estimate and timestamp on the tenant order", async () => {
    const { db, operations } = database();
    await saveTariffEstimate(db, "org-1", "order-1", input, { estimatedTotal: 152, calculatedAt: "2026-10-16T00:00:00.000Z" });
    expect(operations[0]).toMatchObject({
      table: "orders",
      update: {
        india_post_estimate_amount: 152,
        india_post_estimated_at: "2026-10-16T00:00:00.000Z",
        india_post_estimate_key: "v1|BUSINESS_PARCEL|400001|110001|550|20|15|10||",
      },
      filters: [["organization_id", "org-1"], ["id", "order-1"]],
    });
    expect(operations[0].update).not.toHaveProperty("shipping_amount");
    expect(operations[0].update).not.toHaveProperty("tariff_amount");
  });
});

describe("mocked authenticated tariff lookup", () => {
  it("reuses token and makes only a tariff GET with actual weight", async () => {
    const { db, connection, operations } = database();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(executeTariff(db, "org-1", connection, input)).resolves.toMatchObject({ estimatedTotal: 152 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("weight=550");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer cached-token");
    expect(operations.every((op) => op.table === "india_post_connections" && !op.update)).toBe(true);
  });
  it("serializes concurrent expired sessions and persists encrypted tokens", async () => {
    const { db, connection, operations } = database({ expires_at: "2000-01-01" });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { access_token: "new-token", expires_in: 900 } })));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([tariffSession(db, "org-1", connection.id), tariffSession(db, "org-1", connection.id)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const write = operations.find((op) => op.update)!;
    expect(write.filters).toEqual([["organization_id", "org-1"], ["id", "connection-1"]]);
    expect(write.update?.encrypted_access_token).not.toContain("new-token");
  });
  it("fails closed on token persistence errors", async () => {
    const { db, connection } = database({ expires_at: "2000-01-01" }, true);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { access_token: "new-token", expires_in: 900 } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(executeTariff(db, "org-1", connection, input)).rejects.toThrow("Unable to save"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("retries exactly once after 401 and does not reveal provider errors", async () => {
    const { db, connection } = database();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("secret", { status: 401 })).mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { access_token: "new-token", expires_in: 900 } }))).mockResolvedValueOnce(new Response("secret", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(executeTariff(db, "org-1", connection, input)).rejects.toThrow("India Post authentication failed"); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("reuses a token refreshed by another request", async () => {
    const { db, connection } = database(); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await tariffSession(db, "org-1", connection.id, "older-rejected-token"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("succeeds after one reauthentication and persists the replacement session", async () => {
    const { db, connection, operations } = database();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 401 })).mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { access_token: "replacement", expires_in: 900 } }))).mockResolvedValueOnce(new Response(JSON.stringify(response)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(executeTariff(db, "org-1", connection, { ...input, service: "SP_INLAND_PARCEL" })).resolves.toMatchObject({ estimatedTotal: 152 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer replacement");
    expect(operations.filter((op) => op.update)).toHaveLength(1);
    expect(operations.every((op) => op.table === "india_post_connections")).toBe(true);
  });
  it("fails closed when the connection is disconnected", async () => {
    const { db, connection } = database({ status: "DISCONNECTED" }); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(executeTariff(db, "org-1", connection, input)).rejects.toMatchObject({ details: { category: "INDIA_POST_NOT_CONNECTED" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("turns HTTP 200 failure bodies into safe errors", async () => {
    const { db, connection } = database(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, message: "secret provider details" }))));
    await expect(executeTariff(db, "org-1", connection, input)).rejects.toMatchObject({ details: { category: "INDIA_POST_INVALID_RESPONSE" } });
  });
  it.each([400, 403, 429, 500, 503])("normalizes HTTP %s without retry", async (status) => {
    const { db, connection } = database(); const fetchMock = vi.fn().mockResolvedValue(new Response("secret", { status })); vi.stubGlobal("fetch", fetchMock);
    await expect(executeTariff(db, "org-1", connection, input)).rejects.not.toThrow("secret"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("handles timeout and malformed JSON", async () => {
    const { db, connection } = database(); const fetchMock = vi.fn().mockRejectedValueOnce(new DOMException("secret", "TimeoutError")).mockResolvedValueOnce(new Response("not json")); vi.stubGlobal("fetch", fetchMock);
    await expect(executeTariff(db, "org-1", connection, input)).rejects.toThrow("timed out");
    await expect(executeTariff(db, "org-1", connection, input)).rejects.toThrow("invalid estimate");
  });
});
