import type { Metadata } from "next";
import { CodeBlock } from "@/app/(marketing)/developers/docs-code";
import { DocsHeader, Note } from "@/app/(marketing)/developers/docs-ui";
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
      <DocsHeader
        kicker="AI"
        title="Build with AI"
        description="Copy a prompt into ChatGPT, Gemini, Claude, or Cursor together with the OpenAPI file. Do not paste real API keys."
      />
      <Note tone="info">
        Attach{" "}
        <a className="font-medium text-sky-800 underline" href="/developers/openapi.json">
          openapi.json
        </a>{" "}
        so the model only uses implemented routes.
      </Note>
      <div className="mt-8 space-y-8">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-ink">Google Sheets</h2>
          <CodeBlock samples={[{ label: "Prompt", code: prompts.sheets }]} />
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold text-ink">CRM</h2>
          <CodeBlock samples={[{ label: "Prompt", code: prompts.crm }]} />
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold text-ink">ERP</h2>
          <CodeBlock samples={[{ label: "Prompt", code: prompts.erp }]} />
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold text-ink">Custom app</h2>
          <CodeBlock samples={[{ label: "Prompt", code: prompts.custom }]} />
        </section>
      </div>
    </>
  );
}
