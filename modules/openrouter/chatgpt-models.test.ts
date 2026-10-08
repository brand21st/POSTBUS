import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENROUTER_MODEL,
  isChatGptOpenRouterModel,
  mergeChatGptModels,
  sanitizeChatGptOpenRouterModel,
} from "@/modules/openrouter/chatgpt-models";

describe("ChatGPT OpenRouter catalog", () => {
  it("keeps ChatGPT chat models and drops non-chat OpenAI ids", () => {
    expect(isChatGptOpenRouterModel("openai/gpt-4o-mini")).toBe(true);
    expect(isChatGptOpenRouterModel("openai/gpt-5")).toBe(true);
    expect(isChatGptOpenRouterModel("openai/chatgpt-4o-latest")).toBe(true);
    expect(isChatGptOpenRouterModel("openai/o3-mini")).toBe(true);
    expect(isChatGptOpenRouterModel("openai/gpt-4o-audio-preview")).toBe(false);
    expect(isChatGptOpenRouterModel("openai/text-embedding-3-small")).toBe(false);
    expect(isChatGptOpenRouterModel("anthropic/claude-3.5-sonnet")).toBe(false);
  });

  it("falls back to GPT-4o Mini for unknown providers", () => {
    expect(sanitizeChatGptOpenRouterModel("anthropic/claude-3.5-sonnet")).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(sanitizeChatGptOpenRouterModel("openai/gpt-4.1-mini")).toBe("openai/gpt-4.1-mini");
  });

  it("merges live ChatGPT models into a selectable list", () => {
    const models = mergeChatGptModels(
      [{ id: "openai/gpt-4o", name: "GPT-4o" }, { id: "google/gemini-2.0-flash", name: "Gemini" }],
      "openai/gpt-4o-mini"
    );
    expect(models.some((item) => item.id === "openai/gpt-4o-mini")).toBe(true);
    expect(models.some((item) => item.id === "openai/gpt-4o")).toBe(true);
    expect(models.some((item) => item.id.startsWith("google/"))).toBe(false);
  });
});
