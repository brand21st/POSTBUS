import { describe, expect, it } from "vitest";
import {
  isUserOnline,
  latestLastActiveAt,
  PRESENCE_WRITE_MIN_MS,
  shouldWritePresence,
  USER_ONLINE_WINDOW_MS,
} from "@/lib/admin/user-presence";

describe("isUserOnline", () => {
  const now = Date.parse("2026-10-22T08:00:00.000Z");

  it("is false when last active is missing", () => {
    expect(isUserOnline(null, now)).toBe(false);
    expect(isUserOnline(undefined, now)).toBe(false);
  });

  it("is true within the two-minute window", () => {
    expect(isUserOnline(new Date(now - USER_ONLINE_WINDOW_MS + 1).toISOString(), now)).toBe(true);
  });

  it("is false when the timestamp is stale", () => {
    expect(isUserOnline(new Date(now - USER_ONLINE_WINDOW_MS - 1).toISOString(), now)).toBe(false);
  });
});

describe("shouldWritePresence", () => {
  const now = Date.parse("2026-10-22T08:00:00.000Z");

  it("writes when there is no prior timestamp", () => {
    expect(shouldWritePresence(null, now)).toBe(true);
  });

  it("skips writes inside the 45s throttle", () => {
    expect(shouldWritePresence(new Date(now - PRESENCE_WRITE_MIN_MS + 1).toISOString(), now)).toBe(false);
  });
});

describe("latestLastActiveAt", () => {
  it("returns the newest non-null timestamp", () => {
    expect(
      latestLastActiveAt(["2026-10-22T07:00:00.000Z", null, "2026-10-22T08:00:00.000Z"])
    ).toBe("2026-10-22T08:00:00.000Z");
  });
});
