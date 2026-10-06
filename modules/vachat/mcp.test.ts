import { describe, expect, it } from "vitest";
import {
  formatOrderDetailsText,
  handleMcpRpc,
  initializeResult,
  isJsonRpcPayload,
  mcpTools,
  parseSearchOrderDetailsArgs,
  SEARCH_MERCHANT_ORGANIZATION_TOOL,
  SEARCH_ORDER_DETAILS_TOOL,
  type OrderDetailsSearchResult,
} from "@/modules/vachat/mcp";

const sample: OrderDetailsSearchResult = {
  account: "post@post.com",
  assistant: "Order management WhatsApp AI Assistant",
  fetched_at: "2026-10-05T12:00:00.000Z",
  live: true,
  tracking_page: "https://www.postbus.in/track",
  customer_whatsapp: "8848772371",
  found: true,
  answer: "Order PB-10948 is booked. India Post tracking ID EY362666494IN.",
  organizations: [
    {
      merchant_id: "org-zoura",
      name: "Zoura Parfums",
      phone: "9000000000",
      website: null,
      email: null,
      gstin: null,
      address: null,
    },
  ],
  results: [
    {
      merchant_id: "org-zoura",
      merchant_name: "Zoura Parfums",
      merchant_phone: "9000000000",
      merchant_website: null,
      merchant_email: null,
      merchant_gstin: null,
      merchant_address: null,
      organization: {
        id: "org-zoura",
        name: "Zoura Parfums",
        phone: "9000000000",
        website: null,
        email: null,
        gstin: null,
        address: null,
      },
      order_information: {
        order_number: "PB-10948",
        created_at: "2026-10-05T10:00:00.000Z",
        status: "BOOKED",
        payment_status: "COD",
        amount: "499",
        items: ["1x Perfume"],
        customer_name: "Ada",
      },
      shipment_information: {
        status: "BOOKED",
        booked_at: "2026-10-05T12:00:00.000Z",
        weight_grams: "32",
      },
      invoice: {
        number: "INV-2026-000002",
        date: "2026-10-05",
        total: "499",
      },
      tracking: {
        india_post_tracking_id: "EY362666494IN",
        tracking_link: "https://www.postbus.in/track?tracking=EY362666494IN",
        last_scan: "Item Booked",
        last_office: "Kochi HO",
        timeline: [{ at: "2026-10-05T12:00:00.000Z", office: "Kochi HO", description: "Item Booked" }],
      },
      order_number: "PB-10948",
      created_at: "2026-10-05T10:00:00.000Z",
      status: "BOOKED",
      payment_status: "COD",
      amount: "499",
      items: ["1x Perfume"],
      invoice_number: "INV-2026-000002",
      invoice_date: "2026-10-05",
      invoice_total: "499",
      tracking_number: "EY362666494IN",
      shipment_status: "BOOKED",
      booked_at: "2026-10-05T12:00:00.000Z",
      last_scan: "Item Booked",
      last_office: "Kochi HO",
      tracking_url: "https://www.postbus.in/track?tracking=EY362666494IN",
      timeline: [{ at: "2026-10-05T12:00:00.000Z", office: "Kochi HO", description: "Item Booked" }],
    },
  ],
};

describe("VaChat PostBus MCP", () => {
  it("exposes live order and merchant organization search tools", () => {
    expect(mcpTools().map((tool) => tool.name)).toEqual([
      SEARCH_ORDER_DETAILS_TOOL,
      SEARCH_MERCHANT_ORGANIZATION_TOOL,
    ]);
    expect(initializeResult().instructions).toMatch(/search_order_details/);
    expect(initializeResult().instructions).toMatch(/search_merchant_organization/);
    expect(initializeResult().instructions).toContain("+918618456029");
    expect(initializeResult().instructions).toMatch(/post@post.com/);
    expect(initializeResult().instructions).toContain("https://www.postbus.in/track");
    expect(initializeResult().instructions).toMatch(/server-trusted/i);
    expect(mcpTools()[0]?.inputSchema.required).toBeUndefined();
  });

  it("ignores caller identity fields including session_id", () => {
    expect(parseSearchOrderDetailsArgs({})).toEqual({ query: undefined, account: "post@post.com" });
    expect(parseSearchOrderDetailsArgs({ whatsapp: "+918848772371" })).toEqual({
      query: undefined,
      account: "post@post.com",
    });
    expect(
      parseSearchOrderDetailsArgs({
        session_id: "sess-b",
        query: "where is my order",
        whatsapp: "+919998887776",
        merchant_id: "org-b",
        order_id: "ord-b",
      })
    ).toEqual({
      query: "where is my order",
      account: "post@post.com",
    });
  });

  it("rejects a different VaChat account", () => {
    expect(() => parseSearchOrderDetailsArgs({ session_id: "sess-a", account: "other@shop.com" })).toThrow(
      /post@post.com/
    );
  });

  it("handles initialize and tools/list JSON-RPC", async () => {
    const init = await handleMcpRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, async () => sample);
    expect((init.body as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-03-26");
    const list = await handleMcpRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, async () => sample);
    expect((list.body as { result: { tools: Array<{ name: string }> } }).result.tools[0].name).toBe(
      SEARCH_ORDER_DETAILS_TOOL
    );
  });

  it("calls search_order_details over tools/call", async () => {
    const handled = await handleMcpRpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: SEARCH_ORDER_DETAILS_TOOL,
          arguments: { session_id: "sess-a", query: "order details", whatsapp: "+918848772371" },
        },
      },
      async (args) => {
        expect(args.query).toBe("order details");
        expect(args).not.toHaveProperty("sessionId");
        expect(args).not.toHaveProperty("whatsapp");
        return sample;
      }
    );
    const result = (handled.body as { result: { structuredContent: OrderDetailsSearchResult } }).result;
    expect(result.structuredContent.results[0].order_number).toBe("PB-10948");
    expect(result.structuredContent.results[0].tracking_number).toBe("EY362666494IN");
  });

  it("formats a readable tool payload for VaChat", () => {
    const text = formatOrderDetailsText(sample);
    expect(text).toContain("post@post.com");
    expect(text).toContain("PB-10948");
    expect(text).toContain("EY362666494IN");
    expect(text).toContain("Zoura Parfums");
    expect(text).toContain("https://www.postbus.in/track?tracking=EY362666494IN");
    expect(text).toContain("Merchant organization");
    expect(text).toContain("Item Booked");
  });

  it("detects JSON-RPC vs a plain search body", () => {
    expect(isJsonRpcPayload({ jsonrpc: "2.0", method: "tools/list", id: 1 })).toBe(true);
    expect(isJsonRpcPayload({ session_id: "sess-a" })).toBe(false);
  });
});
