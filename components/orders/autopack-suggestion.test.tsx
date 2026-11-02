import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AutoPackSuggestion } from "@/components/orders/autopack-suggestion";
import type { PackageDecision } from "@/modules/autopack/decide";

vi.mock("@/lib/hooks/use-api", () => ({ api: vi.fn() }));

const EVIDENCE = "99999999-9999-4999-8999-999999999999";

function render(decision: PackageDecision | null, props: { applied?: boolean; enabled?: boolean } = {}) {
  const client = new QueryClient();
  if (decision) {
    client.setQueryData(["autopack", "ord-1"], { orderId: "ord-1", shipmentId: null, decision, autoSelectionEnabled: true });
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AutoPackSuggestion orderId="ord-1" enabled={props.enabled ?? true} applied={props.applied} onUse={() => undefined} />
    </QueryClientProvider>
  );
}

const verified: PackageDecision = {
  kind: "CUSTOM_DIMENSIONS",
  box: { lengthCm: 30, widthCm: 25, heightCm: 15 },
  evidence: { type: "history", historyId: EVIDENCE, level: "verified" },
  autoApplicable: true,
  reason: "",
};

describe("AutoPackSuggestion", () => {
  it("shows the AI mark, box and actions for a verified past box", () => {
    const html = render(verified);
    expect(html).toContain("AutoPack suggestion");
    expect(html).toContain("30 × 25 × 15");
    expect(html).toContain("Measured box used before");
    expect(html).toContain("Apply size");
    expect(html).toContain("Not right");
    expect(html).toContain("from-rose-500");
  });

  it("labels confirmed-only history as not measured", () => {
    const html = render({ ...verified, evidence: { type: "history", historyId: EVIDENCE, level: "confirmed" }, autoApplicable: false });
    expect(html).toContain("not marked measured");
  });

  it("shows the applied state instead of the apply button", () => {
    const html = render(verified, { applied: true });
    expect(html).toContain("Applied. Save to keep it");
    expect(html).not.toContain("Apply size");
  });

  it("shows the preset name for a saved package", () => {
    const html = render({ ...verified, kind: "SAVED_PACKAGE", presetId: "p1", presetName: "Mug box" });
    expect(html).toContain("Mug box");
  });

  it("stays quiet when there is no history, and explains conflicts", () => {
    expect(render({ kind: "MANUAL_REVIEW_REQUIRED", reason: "NO_HISTORY", message: "x" })).toBe("");
    expect(render({ kind: "MANUAL_REVIEW_REQUIRED", reason: "CONFLICTING_HISTORY", message: "Different boxes were used." })).toContain(
      "Different boxes were used."
    );
  });

  it("renders nothing when disabled (non-Shopify or booked)", () => {
    expect(render(verified, { enabled: false })).toBe("");
  });
});
