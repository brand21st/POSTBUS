import { describe, expect, it } from "vitest";

describe("merchant API log redaction", () => {
  it("log insert shape excludes bodies, addresses, phones, and secrets", async () => {
    let inserted: Record<string, unknown> | null = null;
    const supabase = {
      from(table: string) {
        expect(table).toBe("merchant_api_request_logs");
        return {
          insert: async (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      },
    };
    const { writeMerchantApiLog } = await import("@/modules/merchant-api/logs");
    await writeMerchantApiLog(supabase as never, {
      organizationId: "org-a",
      apiKeyId: "key-1",
      endpoint: "POST /orders",
      method: "POST",
      responseStatus: 201,
      durationMs: 12,
      requestId: "req-1",
    });
    expect(inserted).toEqual({
      organization_id: "org-a",
      api_key_id: "key-1",
      endpoint: "POST /orders",
      method: "POST",
      response_status: 201,
      duration_ms: 12,
      request_id: "req-1",
    });
    expect(JSON.stringify(inserted)).not.toMatch(/pb_live_|phone|line1|Authorization/i);
  });
});
