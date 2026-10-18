import { afterEach, describe, expect, it } from "vitest";
import { multiUpPrintEnabled } from "@/modules/labels/multi-up/flag";

describe("multi-up flag", () => {
  const previous = process.env.NEXT_PUBLIC_MULTI_UP_PRINT_ENABLED;

  afterEach(() => {
    if (previous == null) delete process.env.NEXT_PUBLIC_MULTI_UP_PRINT_ENABLED;
    else process.env.NEXT_PUBLIC_MULTI_UP_PRINT_ENABLED = previous;
  });

  it("stays on unless explicitly set to false", () => {
    delete process.env.NEXT_PUBLIC_MULTI_UP_PRINT_ENABLED;
    expect(multiUpPrintEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_MULTI_UP_PRINT_ENABLED = "false";
    expect(multiUpPrintEnabled()).toBe(false);
  });
});
