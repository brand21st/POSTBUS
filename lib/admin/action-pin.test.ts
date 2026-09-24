import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import { assertAdminActionPin } from "@/lib/admin/action-pin";

describe("assertAdminActionPin", () => {
  it("accepts the configured 6-digit PIN", () => {
    expect(() => assertAdminActionPin("884877")).not.toThrow();
  });

  it("rejects a wrong PIN", () => {
    expect(() => assertAdminActionPin("000000")).toThrow(AppError);
    expect(() => assertAdminActionPin("88487")).toThrow(AppError);
    expect(() => assertAdminActionPin("")).toThrow(AppError);
  });
});
