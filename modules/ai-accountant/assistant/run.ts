import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { getAddonCatalogRow } from "@/modules/addons/catalog";
import { AI_ACCOUNTANT_SLUG } from "@/modules/addons/constants";
import { getAddonEntitlement } from "@/modules/addons/entitlements";
import { openRouterToolSpecs, runAssistantTool } from "@/modules/ai-accountant/assistant/tools";
import { fiscalYearPeriod, istDate } from "@/modules/ai-accountant/period";
import {
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_API_BASE,
  getPlatformOpenRouterConfig,
} from "@/modules/openrouter/platform-config";

const METRIC = "assistant_questions";
const MAX_TOOL_ROUNDS = 4;
const HISTORY_MESSAGES = 10;

export const askSchema = z.object({
  question: z.string().trim().min(3).max(1000),
  threadId: z.string().uuid().optional(),
});

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Completion = {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
};

export type ChatFetch = (body: Record<string, unknown>, apiKey: string) => Promise<Completion>;

const defaultFetch: ChatFetch = async (body, apiKey) => {
  const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://postbus.in",
      "X-Title": "PostBus AI Accountant",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
  return (await response.json()) as Completion;
};

export function systemPrompt(today: string, fiscalStartMonth: number) {
  const fy = fiscalYearPeriod(today, fiscalStartMonth);
  return [
    "You are the PostBus AI Accountant for an Indian e-commerce merchant who ships with India Post.",
    `Today is ${today} (IST). The current financial year is ${fy.label} (${fy.from} to ${fy.to}).`,
    "Answer only from tool results. Call tools to get figures; never estimate, invent or extrapolate totals, GST payable, profit or savings.",
    "Amounts in tool results are integer paise unless a field says rupees; show money as ₹ with Indian digit grouping (e.g. ₹1,23,456.78).",
    "If a result has completeness INCOMPLETE or a status of NEEDS_REVIEW, say the figure is not verified and name what is missing.",
    "GST figures are drafts, not filed returns. Do not give legal or tax-filing advice; suggest confirming with a chartered accountant for filing decisions.",
    "If the question is not about this merchant's books, say you can only help with their PostBus accounts.",
    "Be concise: a direct answer first, then up to five short bullet points.",
  ].join("\n");
}

/** Atomic per-period quota; returns the usage row to refund if the answer fails. */
async function consumeQuestion(supabase: SupabaseClient, organizationId: string) {
  const [entitlement, catalog] = await Promise.all([
    getAddonEntitlement(supabase, organizationId),
    getAddonCatalogRow(supabase, AI_ACCOUNTANT_SLUG),
  ]);
  const limit = Number(catalog?.included_assistant_questions ?? 0);
  const { data, error } = await supabase.rpc("consume_addon_question", {
    p_org: organizationId,
    p_slug: AI_ACCOUNTANT_SLUG,
    p_metric: METRIC,
    p_period_start: entitlement?.current_period_start ?? null,
    p_limit: limit,
  });
  if (error) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not check your assistant quota.");
  const row = (Array.isArray(data) ? data[0] : data) as { usage_id: string | null; used: number; remaining: number } | null;
  if (!row?.usage_id) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, "You have used all included AI Accountant questions for this billing period.");
  }
  return { usageId: row.usage_id, included: limit, used: row.used, remaining: row.remaining };
}

export async function remainingAssistantQuota(supabase: SupabaseClient, organizationId: string) {
  const [entitlement, catalog] = await Promise.all([
    getAddonEntitlement(supabase, organizationId),
    getAddonCatalogRow(supabase, AI_ACCOUNTANT_SLUG),
  ]);
  const included = Number(catalog?.included_assistant_questions ?? 0);
  const { data } = await supabase
    .from("addon_usage_events")
    .select("quantity")
    .eq("organization_id", organizationId)
    .eq("addon_slug", AI_ACCOUNTANT_SLUG)
    .eq("metric", METRIC)
    .gte("created_at", entitlement?.current_period_start ?? new Date(0).toISOString());
  const used = (data ?? []).reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
  return { included, used, remaining: Math.max(0, included - used) };
}

async function threadHistory(supabase: SupabaseClient, organizationId: string, threadId: string): Promise<ChatMessage[]> {
  const { data: thread } = await supabase
    .from("ai_accountant_threads")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Conversation not found.");
  const { data } = await supabase
    .from("ai_accountant_messages")
    .select("role, content")
    .eq("organization_id", organizationId)
    .eq("thread_id", threadId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(HISTORY_MESSAGES);
  return (data ?? [])
    .reverse()
    .map((row) => ({ role: row.role as "user" | "assistant", content: String((row.content as { text?: string })?.text ?? "") }))
    .filter((m) => m.content);
}

export async function askAiAccountant(
  supabase: SupabaseClient,
  input: { organizationId: string; userId: string; raw: unknown; chat?: ChatFetch }
) {
  const { organizationId } = input;
  const body = askSchema.parse(input.raw);
  const config = await getPlatformOpenRouterConfig();
  if (!config.enabled || !config.apiKey) {
    throw new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "The accounting assistant is not configured.");
  }
  const history = body.threadId ? await threadHistory(supabase, organizationId, body.threadId) : [];
  const quota = await consumeQuestion(supabase, organizationId);
  const { data: settings } = await supabase
    .from("accounting_settings")
    .select("fiscal_year_start_month")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(istDate(), Number(settings?.fiscal_year_start_month ?? 4)) },
    ...history,
    { role: "user", content: body.question },
  ];
  const toolLog: Array<{ name: string; arguments: string; ok: boolean; result?: string; error?: string }> = [];
  const model = config.model || DEFAULT_OPENROUTER_MODEL;
  const chat = input.chat ?? defaultFetch;
  let answer = "";
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const lastRound = round === MAX_TOOL_ROUNDS;
      const completion = await chat(
        {
          model,
          temperature: 0.1,
          messages,
          tools: openRouterToolSpecs(),
          tool_choice: lastRound ? "none" : "auto",
        },
        config.apiKey
      );
      tokensIn += completion.usage?.prompt_tokens ?? 0;
      tokensOut += completion.usage?.completion_tokens ?? 0;
      const message = completion.choices?.[0]?.message;
      const calls = message?.tool_calls ?? [];
      if (!calls.length || lastRound) {
        answer = message?.content?.trim() ?? "";
        break;
      }
      messages.push({ role: "assistant", content: message?.content ?? null, tool_calls: calls });
      for (const call of calls.slice(0, 6)) {
        const result = await runAssistantTool(supabase, organizationId, call.function.name, call.function.arguments);
        toolLog.push({ name: call.function.name, arguments: call.function.arguments, ...result });
        messages.push({ role: "tool", tool_call_id: call.id, content: result.ok ? result.result! : JSON.stringify({ error: result.error }) });
      }
    }
    if (!answer) throw new Error("empty answer");
  } catch (error) {
    await supabase.from("addon_usage_events").delete().eq("id", quota.usageId);
    logError("ai_accountant.assistant_failed", { organizationId, message: error instanceof Error ? error.message : "unknown" });
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "The accounting assistant is temporarily unavailable. Your question was not counted.");
  }

  let threadId = body.threadId ?? null;
  if (!threadId) {
    const { data } = await supabase
      .from("ai_accountant_threads")
      .insert({ organization_id: organizationId, title: body.question.slice(0, 80), created_by: input.userId })
      .select("id")
      .single();
    threadId = (data?.id as string | undefined) ?? null;
  } else {
    await supabase.from("ai_accountant_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
  }
  if (threadId) {
    await supabase.from("ai_accountant_messages").insert([
      { organization_id: organizationId, thread_id: threadId, role: "user", content: { text: body.question } },
      {
        organization_id: organizationId,
        thread_id: threadId,
        role: "assistant",
        content: { text: answer },
        tool_calls: toolLog.map(({ name, arguments: args, ok, error }) => ({ name, arguments: args, ok, error })),
        model,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
      },
    ]);
  }
  return {
    threadId,
    answer,
    tools: toolLog.map(({ name, arguments: args, ok }) => ({ name, arguments: args, ok })),
    quota: { included: quota.included, used: quota.used, remaining: quota.remaining },
  };
}

export async function listThreads(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("ai_accountant_threads")
    .select("id, title, created_at, updated_at")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(50);
  return { threads: data ?? [] };
}

export async function getThread(supabase: SupabaseClient, organizationId: string, threadId: string) {
  const { data: thread } = await supabase
    .from("ai_accountant_threads")
    .select("id, title, created_at")
    .eq("organization_id", organizationId)
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Conversation not found.");
  const { data: messages } = await supabase
    .from("ai_accountant_messages")
    .select("id, role, content, tool_calls, created_at")
    .eq("organization_id", organizationId)
    .eq("thread_id", threadId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .limit(200);
  return { thread, messages: messages ?? [] };
}
