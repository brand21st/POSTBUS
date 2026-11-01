import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("session proxy matcher", () => {
    it("leaves the Next.js development HMR socket outside the session proxy", () => {
        const source = readFileSync("proxy.ts", "utf8");
        expect(source).toContain("_next/hmr");
        expect(source).toContain("_next/webpack-hmr");
    });
});
