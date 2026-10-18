import type { Metadata } from "next";
import { marketingMetadata } from "@/lib/seo/metadata";
import { merchantAiIntegrationPrompt } from "@/modules/merchant-api/ai-prompt";

export const metadata: Metadata = marketingMetadata({
  title: "Build PostBus integrations with AI",
  description: "Copyable prompts for ChatGPT, Gemini, Claude, and Cursor that only use documented PostBus endpoints.",
  path: "/developers/build-with-ai",
});

export default function BuildWithAiPage() {
  const prompts = merchantAiIntegrationPrompt("all") as {
    sheets: string;
    crm: string;
    erp: string;
    custom: string;
  };
  return (
    <>
      <h1>Build with AI</h1>
      <p>
        Copy a prompt into ChatGPT, Gemini, Claude, or Cursor together with the{" "}
        <a href="/developers/openapi.json">OpenAPI file</a>. Do not paste real API keys.
      </p>
      <h2>Google Sheets</h2>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap">{prompts.sheets}</pre>
      <h2>CRM</h2>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap">{prompts.crm}</pre>
      <h2>ERP</h2>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap">{prompts.erp}</pre>
      <h2>Custom app</h2>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap">{prompts.custom}</pre>
    </>
  );
}
