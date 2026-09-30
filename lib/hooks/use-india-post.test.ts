import { describe, expect, it } from "vitest";
import { INDIA_POST_QUERY_KEY } from "@/lib/hooks/use-india-post";

describe("india-post query", () => {
  it("shares one cache key for the topbar and service contracts", () => {
    expect(INDIA_POST_QUERY_KEY).toEqual(["india-post"]);
  });
});
