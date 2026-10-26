"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Send, Sparkles, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

type Thread = { id: string; title: string | null; updated_at: string };
type Message = { id: string; role: "user" | "assistant"; content: { text?: string }; tool_calls?: Array<{ name: string; ok: boolean }> | null };
type Quota = { included: number; used: number; remaining: number };

const SUGGESTIONS = [
  "What was my net profit last month?",
  "How much GST will I owe for last month?",
  "Which COD remittances need my attention?",
  "What are my biggest expenses this financial year?",
  "Compare revenue and profit month by month this year.",
];

const TOOL_LABELS: Record<string, string> = {
  get_books_status: "Books status",
  get_profit_and_loss: "Profit & loss",
  get_cashflow: "Cash flow",
  get_balance_sheet: "Balance sheet",
  get_trial_balance: "Trial balance",
  get_gst_summary: "GST summary",
  get_cod_status: "COD status",
  list_top_expenses: "Expenses",
  get_order_profit: "Order profit",
};

export default function AssistantPage() {
  const client = useQueryClient();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const threads = useQuery({
    queryKey: ["ai-accountant", "threads"],
    queryFn: () => api<{ threads: Thread[]; quota: Quota }>("/api/v1/ai-accountant/assistant/threads"),
  });
  const thread = useQuery({
    queryKey: ["ai-accountant", "thread", threadId],
    queryFn: () => api<{ messages: Message[] }>(`/api/v1/ai-accountant/assistant/threads/${threadId}`),
    enabled: Boolean(threadId),
  });
  const ask = useMutation({
    mutationFn: (text: string) =>
      api<{ threadId: string; answer: string; quota: Quota }>("/api/v1/ai-accountant/assistant", {
        method: "POST",
        body: JSON.stringify({ question: text, threadId: threadId ?? undefined }),
      }),
    onMutate: (text) => setPending(text),
    onSuccess: (data) => {
      setThreadId(data.threadId);
      setQuestion("");
      client.invalidateQueries({ queryKey: ["ai-accountant", "threads"] });
      client.invalidateQueries({ queryKey: ["ai-accountant", "thread", data.threadId] });
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => setPending(null),
  });
  const messages = threadId ? thread.data?.messages ?? [] : [];
  const quota = threads.data?.quota;
  const exhausted = quota ? quota.remaining <= 0 : false;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length >= 3 && !ask.isPending) ask.mutate(trimmed);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <Card className="h-fit">
        <CardContent className="space-y-2 p-3">
          <Button size="sm" variant="secondary" className="w-full" onClick={() => setThreadId(null)}>
            <Plus className="size-4" /> New question
          </Button>
          {quota ? (
            <div className="px-1 py-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-soft">
                <div className="h-full bg-brand" style={{ width: `${Math.min(100, (quota.used / Math.max(1, quota.included)) * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {quota.remaining} of {quota.included} questions left this period
              </p>
            </div>
          ) : null}
          <div className="max-h-[420px] space-y-0.5 overflow-y-auto">
            {(threads.data?.threads ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setThreadId(t.id)}
                className={cn("block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm", threadId === t.id ? "bg-surface-soft text-ink" : "text-muted hover:text-ink")}
              >
                {t.title || "Untitled"}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="flex min-h-[560px] flex-col">
        <CardContent className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex-1 space-y-4 overflow-y-auto">
            {!messages.length && !pending ? (
              <div className="space-y-4 py-6">
                <div className="flex items-center gap-2 text-ink">
                  <Sparkles className="size-5 text-brand" />
                  <p className="font-medium">Ask about your books</p>
                </div>
                <p className="max-w-xl text-sm text-muted">
                  Answers come only from your PostBus ledger, GST drafts, COD reconciliation and expenses. Unverified figures are flagged, and GST answers are drafts to confirm with your CA.
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" disabled={exhausted || ask.isPending} onClick={() => submit(s)} className="rounded-full border border-border px-3 py-1.5 text-xs text-ink hover:bg-surface-soft disabled:opacity-50">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message) => (
              <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm", message.role === "user" ? "bg-brand text-white" : "border border-border bg-card text-ink")}>
                  <p className="whitespace-pre-wrap">{message.content?.text}</p>
                  {message.role === "assistant" && message.tool_calls?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {message.tool_calls.map((call, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-surface-soft px-2 py-0.5 text-[11px] text-muted">
                          <Wrench className="size-3" />
                          {TOOL_LABELS[call.name] ?? call.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {pending ? (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-brand px-4 py-2.5 text-sm text-white">{pending}</div>
                </div>
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-border px-4 py-2.5 text-sm text-muted">Checking your books…</div>
                </div>
              </>
            ) : null}
            <div ref={bottom} />
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(question);
            }}
          >
            <Textarea
              rows={2}
              value={question}
              maxLength={1000}
              disabled={exhausted}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(question);
                }
              }}
              placeholder={exhausted ? "You have used this period's questions." : "Ask about profit, GST, COD or expenses…"}
            />
            <Button type="submit" size="icon" aria-label="Send" disabled={exhausted || ask.isPending || question.trim().length < 3}>
              <Send className="size-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
