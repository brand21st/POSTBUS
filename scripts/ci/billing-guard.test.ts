import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkBillingTree } from "./billing-guard.mjs";

type Violation = { id: string; message: string };
const check = checkBillingTree as (read: (relative: string) => string | null) => Violation[];

function workingTree(relative: string) {
  const file = path.join(process.cwd(), relative);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

describe("billing release guard", () => {
  it("passes the hardened tree", () => {
    expect(check(workingTree)).toEqual([]);
  });

  it("blocks the pre-fix checkout and resume code (F-01 / F-02)", () => {
    const vulnerable = `
export async function startCheckout(supabase, input) {
  await supabase.from("subscriptions").update({ ...checkoutPatch }).eq("id", live.id);
  await supabase.from("subscriptions").insert({ organization_id: input.organizationId, plan_id: plan.id, status: "TRIAL" });
}
export async function verifyCheckout(supabase, input) {
  if (status !== "captured" && status !== "authorized") throw new Error("no");
}
export async function resumeSubscription(supabase, input) {
  await supabase.from("subscriptions").update({ status: "ACTIVE", cancel_at_period_end: false }).eq("id", live.id);
}
`;
    const ids = check((relative) =>
      relative === "modules/billing/subscriptions.ts" ? vulnerable : workingTree(relative)
    ).map((violation) => violation.id);
    expect(ids).toEqual(expect.arrayContaining(["F-01", "F-02", "F-11", "verify-rpc"]));
  });

  it("blocks a checkout dismissal that calls a billing mutation", () => {
    const button = `modal: { ondismiss: () => { api("/api/v1/billing/verify", {}); } }, handler: async () => {}`;
    const ids = check((relative) =>
      relative === "components/billing/checkout-button.tsx" ? button : workingTree(relative)
    ).map((violation) => violation.id);
    expect(ids).toContain("dismiss");
  });
});
