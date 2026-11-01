import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("shipment detail polling", () => {
  const source = readFileSync(path.join(process.cwd(), "app/(site)/dashboard/shipments/[id]/page.tsx"), "utf8");

  it("refreshes cached shipment data with GET and does not POST India Post every 15 seconds", () => {
    expect(source).toContain("`/api/v1/shipments/${params.id}`");
    expect(source).toMatch(/refetchInterval/);
    expect(source).not.toMatch(/setInterval\(pull/);
    expect(source).not.toMatch(/syncMutate/);
    expect(source).not.toMatch(/mutationFn: async \(silent: boolean\)/);
    expect(source).toMatch(/\/api\/v1\/ndr-rto\/\$\{params\.id\}\/sync/);
  });
});
