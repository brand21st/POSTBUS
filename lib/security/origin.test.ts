import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import { assertBrowserOrigin, originsMatch } from "./origin";

describe("originsMatch", () => {
  it("accepts an exact origin", () => {
    expect(originsMatch("https://www.postbus.in", "https://www.postbus.in")).toBe(true);
  });

  it("treats local loopback names on the same port as one site", () => {
    expect(originsMatch("http://127.0.0.1:3000", "http://localhost:3000")).toBe(true);
    expect(originsMatch("http://localhost:3000", "http://127.0.0.1:3000")).toBe(true);
    expect(originsMatch("http://[::1]:3000", "http://localhost:3000")).toBe(true);
  });

  it("rejects a different site, port, or protocol", () => {
    expect(originsMatch("https://evil.example", "https://www.postbus.in")).toBe(false);
    expect(originsMatch("http://127.0.0.1:3000", "https://www.postbus.in")).toBe(false);
    expect(originsMatch("http://127.0.0.1:4000", "http://localhost:3000")).toBe(false);
    expect(originsMatch("https://127.0.0.1:3000", "http://localhost:3000")).toBe(false);
    expect(originsMatch(null, "http://localhost:3000")).toBe(false);
  });

  it("rejects a missing origin when required and a mismatched origin always", () => {
    const print = new NextRequest("http://localhost/api/v1/label-template/multi-sheet", { method: "POST" });
    expect(() => assertBrowserOrigin(print, true)).toThrow(AppError);
    const evil = new NextRequest("http://localhost/api/v1/label-template/multi-sheet", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(() => assertBrowserOrigin(evil, false)).toThrow(/PostBus app/);
    const same = new NextRequest("http://localhost/api/v1/label-template/multi-sheet", {
      method: "POST",
      headers: { Origin: "http://localhost" },
    });
    expect(() => assertBrowserOrigin(same, true)).not.toThrow();
  });
});
