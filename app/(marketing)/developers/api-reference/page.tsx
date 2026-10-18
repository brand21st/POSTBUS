import type { Metadata } from "next";
import { readFile } from "fs/promises";
import path from "path";
import { marketingMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = marketingMetadata({
  title: "Merchant API reference",
  description: "Implemented PostBus Merchant API v1 endpoints, errors, rate limits, and idempotency.",
  path: "/developers/api-reference",
});

export default async function ApiReferencePage() {
  const content = await readFile(path.join(process.cwd(), "docs/merchant-api/POSTBUS_API_REFERENCE.md"), "utf8");
  return (
    <>
      <h1>API reference</h1>
      <p>
        Machine-readable spec: <a href="/developers/openapi.json">openapi.json</a> and{" "}
        <a href="/developers/openapi.yaml">openapi.yaml</a>.
      </p>
      <pre className="max-h-[48rem] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm">
        {content}
      </pre>
    </>
  );
}
