import { env } from "@/lib/env";

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export type OpenRouterChatGptModel = {
  id: string;
  name: string;
};

/** Curated ChatGPT / GPT chat models on OpenRouter. Used when the live catalog is unavailable. */
export const CHATGPT_OPENROUTER_MODELS: OpenRouterChatGptModel[] = [
  { id: "openai/gpt-5", name: "GPT-5" },
  { id: "openai/gpt-5-mini", name: "GPT-5 Mini" },
  { id: "openai/gpt-5-nano", name: "GPT-5 Nano" },
  { id: "openai/gpt-5-chat", name: "GPT-5 Chat" },
  { id: "openai/gpt-4.1", name: "GPT-4.1" },
  { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" },
  { id: "openai/gpt-4.1-nano", name: "GPT-4.1 Nano" },
  { id: "openai/gpt-4o", name: "GPT-4o" },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
  { id: "openai/chatgpt-4o-latest", name: "ChatGPT-4o Latest" },
  { id: "openai/gpt-4-turbo", name: "GPT-4 Turbo" },
  { id: "openai/o4-mini", name: "o4 Mini" },
  { id: "openai/o3", name: "o3" },
  { id: "openai/o3-mini", name: "o3 Mini" },
  { id: "openai/o1", name: "o1" },
  { id: "openai/o1-mini", name: "o1 Mini" },
];

const SKIP =
  /embedding|whisper|tts|dall-e|audio|realtime|transcribe|moderation|image|sora|codex|search-preview|computer-use|gpt-3\.5/i;

export function isChatGptOpenRouterModel(id: string) {
  const model = id.trim();
  if (!model.startsWith("openai/")) return false;
  if (SKIP.test(model)) return false;
  if (/-\d{4}-\d{2}-\d{2}/.test(model)) return false;
  return /\/gpt-|\/chatgpt-|\/o1|\/o3|\/o4/.test(model);
}

export function displayChatGptModelName(id: string, liveName?: string) {
  const known = CHATGPT_OPENROUTER_MODELS.find((item) => item.id === id);
  if (known) return known.name;
  if (liveName?.trim() && !liveName.includes("/")) return liveName.trim();
  return id.replace(/^openai\//, "").replace(/-/g, " ");
}

export function mergeChatGptModels(
  live: OpenRouterChatGptModel[],
  selected?: string | null
): OpenRouterChatGptModel[] {
  const byId = new Map<string, OpenRouterChatGptModel>();
  for (const item of CHATGPT_OPENROUTER_MODELS) byId.set(item.id, item);
  for (const item of live) {
    if (!isChatGptOpenRouterModel(item.id)) continue;
    byId.set(item.id, { id: item.id, name: displayChatGptModelName(item.id, item.name) });
  }
  const selectedId = selected?.trim();
  if (selectedId && isChatGptOpenRouterModel(selectedId) && !byId.has(selectedId)) {
    byId.set(selectedId, { id: selectedId, name: displayChatGptModelName(selectedId) });
  }
  const preferred = [
    DEFAULT_OPENROUTER_MODEL,
    "openai/gpt-4o",
    "openai/gpt-4.1-mini",
    "openai/gpt-5-mini",
  ];
  const rest = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  const ordered: OpenRouterChatGptModel[] = [];
  for (const id of preferred) {
    const item = byId.get(id);
    if (item && !ordered.some((row) => row.id === id)) ordered.push(item);
  }
  for (const item of rest) {
    if (!ordered.some((row) => row.id === item.id)) ordered.push(item);
  }
  return ordered;
}

export async function fetchOpenRouterChatGptModels(apiKey?: string): Promise<OpenRouterChatGptModel[]> {
  try {
    const headers: Record<string, string> = {
      "HTTP-Referer": (env.appUrl || "https://postbus.in").replace(/\/$/, ""),
      "X-Title": "PostBus",
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers,
      signal: AbortSignal.timeout(12000),
    });
    const json = (await response.json().catch(() => ({}))) as {
      data?: Array<{ id?: string; name?: string }>;
    };
    if (!response.ok || !Array.isArray(json.data)) return [];
    return json.data
      .map((row) => ({ id: String(row.id ?? "").trim(), name: String(row.name ?? "").trim() }))
      .filter((row) => isChatGptOpenRouterModel(row.id));
  } catch {
    return [];
  }
}

export function sanitizeChatGptOpenRouterModel(value?: string | null) {
  const model = String(value ?? "").trim();
  if (isChatGptOpenRouterModel(model) && model.length <= 80) return model;
  return DEFAULT_OPENROUTER_MODEL;
}
