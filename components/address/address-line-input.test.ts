import { describe, expect, it } from "vitest";
import {
  ADDRESS_LINE_REMAINING_WARN,
  addressLineRemaining,
  clipIndiaPostAddressLine,
  shouldShowAddressLineRemaining,
} from "./address-line-input";
import { INDIA_POST_ADDRESS_LINE_MAX } from "@/modules/india-post/spec";

describe("address line remaining", () => {
  it("clips to the India Post line length", () => {
    expect(clipIndiaPostAddressLine("x".repeat(90))).toHaveLength(INDIA_POST_ADDRESS_LINE_MAX);
    expect(clipIndiaPostAddressLine("House 12")).toBe("House 12");
  });

  it("counts characters left without going negative", () => {
    expect(addressLineRemaining(0)).toBe(INDIA_POST_ADDRESS_LINE_MAX);
    expect(addressLineRemaining(33)).toBe(INDIA_POST_ADDRESS_LINE_MAX - 33);
    expect(addressLineRemaining(INDIA_POST_ADDRESS_LINE_MAX)).toBe(0);
    expect(addressLineRemaining(INDIA_POST_ADDRESS_LINE_MAX + 10)).toBe(0);
  });

  it("stays quiet until focus or the last stretch", () => {
    expect(shouldShowAddressLineRemaining(INDIA_POST_ADDRESS_LINE_MAX, false)).toBe(false);
    expect(shouldShowAddressLineRemaining(INDIA_POST_ADDRESS_LINE_MAX, true)).toBe(true);
    expect(shouldShowAddressLineRemaining(ADDRESS_LINE_REMAINING_WARN, false)).toBe(true);
    expect(shouldShowAddressLineRemaining(0, false)).toBe(true);
  });
});
