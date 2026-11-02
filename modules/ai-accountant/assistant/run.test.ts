import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/modules/openrouter/platform-config", () => ({
  DEFAULT_OPENROUTER_MODEL: "test/model",
  OPENROUTER_API_BASE: "https://example.invalid",
  getPlatformOpenRouterConfig: vi.fn(async () => ({ enabled: true, apiKey: "k", model: "test/model" })),
}));
vi.mock("@/modules/addons/entitlements", () => ({
  getAddonEntitlement: vi.fn(async () => ({ current_period_start: "2026-10-01T00:00:00Z" })),
}));
vi.mock("@/modules/addons/catalog", () => ({
  getAddonCatalogRow: vi.fn(async () => ({ included_assistant_questions: 50 })),
}));
vi.mock("@/modules/ai-accountant/reports/service", () => ({
  profitAndLoss: vi.fn(async (_s: unknown, _o: string, period: { from: string; to: string }) => ({
    period,
    revenuePaise: 1_000_00,
    netProfitPaise: 250_00,
    completeness: "ACTUAL",
  })),
  cashflow: vi.fn(),
  balanceSheet: vi.fn(),
  trialBalance: vi.fn(),
}));

import { askAiAccountant, systemPrompt, type ChatFetch } from "@/modules/ai-accountant/assistant/run";
import { runAssistantTool } from "@/modules/ai-accountant/assistant/tools";

type Call = { table: string; op: string; payload?: unknown };

function fakeSupabase(options: { quotaExhausted?: boolean } = {}) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    let op = "select";
    let payload: unknown;
    const chain: Record<string, unknown> = {};
    const result = () => {
      calls.push({ table, op, payload });
      if (table === "ai_accountant_threads" && op === "insert") return { data: { id: "thread-1" }, error: null };
      return { data: op === "select" ? null : null, error: null };
    };
    for (const name of ["select", "eq", "in", "order", "limit", "gte", "lte", "neq"]) chain[name] = () => chain;
    chain.insert = (value: unknown) => ((op = "insert"), (payload = value), chain);
    chain.update = (value: unknown) => ((op = "update"), (payload = value), chain);
    chain.delete = () => ((op = "delete"), chain);
    chain.maybeSingle = async () => result();
    chain.single = async () => result();
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return chain;
  };
  const client = {
    from: builder,
    rpc: vi.fn(async (name: string) => {
      calls.push({ table: name, op: "rpc" });
      return options.quotaExhausted
        ? { data: [{ usage_id: null, used: 50, remaining: 0 }], error: null }
        : { data: [{ usage_id: "usage-1", used: 3, remaining: 47 }], error: null };
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("askAiAccountant", () => {
  let chat: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    chat = vi.fn();
  });

  it("runs a tool round, then answers from the tool result and stores the thread", async () => {
    const { client, calls } = fakeSupabase();
    chat
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: "c1", type: "function", function: { name: "get_profit_and_loss", arguments: '{"from":"2026-09-01","to":"2026-09-30"}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: "Net profit for September was ₹250.00." } }], usage: { prompt_tokens: 200, completion_tokens: 20 } });

    const result = await askAiAccountant(client, { organizationId: "org", userId: "u", raw: { question: "Profit last month?" }, chat: chat as unknown as ChatFetch });
    expect(result.answer).toContain("₹250.00");
    expect(result.threadId).toBe("thread-1");
    expect(result.tools).toEqual([{ name: "get_profit_and_loss", arguments: '{"from":"2026-09-01","to":"2026-09-30"}', ok: true }]);
    const secondRequest = chat.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> };
    const toolMessage = secondRequest.messages.find((m) => m.role === "tool");
    expect(JSON.parse(toolMessage!.content)).toMatchObject({ netProfitPaise: 25000 });
    expect(calls.some((c) => c.table === "ai_accountant_messages" && c.op === "insert")).toBe(true);
    expect(calls.some((c) => c.table === "addon_usage_events" && c.op === "delete")).toBe(false);
  });

  it("refunds the question when the provider fails", async () => {
    const { client, calls } = fakeSupabase();
    chat.mockRejectedValueOnce(new Error("OpenRouter 500"));
    await expect(
      askAiAccountant(client, { organizationId: "org", userId: "u", raw: { question: "Profit?" }, chat: chat as unknown as ChatFetch })
    ).rejects.toThrow(/not counted/);
    expect(calls.some((c) => c.table === "addon_usage_events" && c.op === "delete")).toBe(true);
  });

  it("refuses when the period quota is used up, before calling the model", async () => {
    const { client } = fakeSupabase({ quotaExhausted: true });
    await expect(
      askAiAccountant(client, { organizationId: "org", userId: "u", raw: { question: "Profit?" }, chat: chat as unknown as ChatFetch })
    ).rejects.toThrow(/used all included/);
    expect(chat).not.toHaveBeenCalled();
  });

  it("stops tool calls after the round limit and forces an answer", async () => {
    const { client } = fakeSupabase();
    const toolTurn = {
      choices: [{ message: { content: null, tool_calls: [{ id: "c", type: "function", function: { name: "get_books_status", arguments: "{}" } }] } }],
    };
    chat.mockResolvedValue(toolTurn);
    chat.mockResolvedValueOnce(toolTurn).mockResolvedValueOnce(toolTurn).mockResolvedValueOnce(toolTurn).mockResolvedValueOnce(toolTurn);
    chat.mockResolvedValueOnce({ choices: [{ message: { content: "Done." } }] });
    const result = await askAiAccountant(client, { organizationId: "org", userId: "u", raw: { question: "Status?" }, chat: chat as unknown as ChatFetch });
    expect(result.answer).toBe("Done.");
    const last = chat.mock.calls.at(-1)![0] as { tool_choice: string };
    expect(last.tool_choice).toBe("none");
  });
});

describe("tools and prompt", () => {
  it("rejects bad tool arguments without running anything", async () => {
    const { client } = fakeSupabase();
    expect(await runAssistantTool(client, "org", "get_profit_and_loss", '{"from":"2026-10-31","to":"2026-10-01"}')).toMatchObject({ ok: false });
    expect(await runAssistantTool(client, "org", "drop_tables", "{}")).toMatchObject({ ok: false });
    expect(await runAssistantTool(client, "org", "get_profit_and_loss", "not json")).toMatchObject({ ok: false });
  });

  it("anchors the prompt to today and the fiscal year and forbids invented figures", () => {
    const prompt = systemPrompt("2026-10-26", 4);
    expect(prompt).toContain("FY 2026-27");
    expect(prompt).toMatch(/never estimate, invent/);
  });
});
