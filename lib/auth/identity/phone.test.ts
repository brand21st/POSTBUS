import { describe, expect, it, vi } from "vitest";
import { resolvePhoneIdentity } from "@/lib/auth/identity/phone";
import { requestOtp, verifyOtp, type OtpDeps } from "@/lib/auth/otp/service";
import { MemoryOtpStore } from "@/lib/auth/otp/memory-store";
import { OTP_MESSAGES } from "@/lib/auth/otp/policy";

const PHONE = "+919876543210";

function admin(input: {
  identity?: { data: { user_id: string } | null; error: { message: string } | null };
  profiles?: { data: { id: string }[] | null; error: { message: string } | null };
  user?: { data: { user: { id: string; email?: string | null } | null }; error: { message: string } | null };
}) {
  return {
    from(table: string) {
      if (table === "phone_identities") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => input.identity ?? { data: null, error: null },
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: async () => input.profiles ?? { data: [], error: null },
        }),
      };
    },
    auth: {
      admin: {
        getUserById: vi.fn(async () => input.user ?? { data: { user: null }, error: null }),
      },
    },
  };
}

describe("resolvePhoneIdentity", () => {
  it("returns the mapped user when lookup succeeds", async () => {
    const result = await resolvePhoneIdentity(
      admin({
        identity: { data: { user_id: "user-1" }, error: null },
        user: { data: { user: { id: "user-1", email: "priya@example.com" } }, error: null },
      }) as never,
      PHONE
    );
    expect(result).toEqual({ kind: "unique", userId: "user-1", email: "priya@example.com" });
  });

  it("fails closed when the identity row exists but auth lookup fails", async () => {
    const result = await resolvePhoneIdentity(
      admin({
        identity: { data: { user_id: "user-1" }, error: null },
        user: { data: { user: null }, error: { message: "timeout" } },
      }) as never,
      PHONE
    );
    expect(result).toEqual({ kind: "error", reason: "LOOKUP_FAILED" });
  });

  it("fails closed when the only profile cannot be resolved to an auth user", async () => {
    const result = await resolvePhoneIdentity(
      admin({
        profiles: { data: [{ id: "user-1" }], error: null },
        user: { data: { user: null }, error: { message: "missing" } },
      }) as never,
      PHONE
    );
    expect(result).toEqual({ kind: "error", reason: "LOOKUP_FAILED" });
  });

  it("fails closed when the auth user has no email", async () => {
    const result = await resolvePhoneIdentity(
      admin({
        profiles: { data: [{ id: "user-1" }], error: null },
        user: { data: { user: { id: "user-1", email: "  " } }, error: null },
      }) as never,
      PHONE
    );
    expect(result).toEqual({ kind: "error", reason: "MISSING_EMAIL" });
  });

  it("treats a phone with no identity and no profile as new", async () => {
    const result = await resolvePhoneIdentity(admin({}) as never, PHONE);
    expect(result).toEqual({ kind: "none" });
  });

  it("does not pick one profile when the number is duplicated", async () => {
    const result = await resolvePhoneIdentity(
      admin({
        profiles: { data: [{ id: "user-1" }, { id: "user-2" }], error: null },
      }) as never,
      PHONE
    );
    expect(result).toEqual({ kind: "duplicate" });
  });
});

describe("duplicate phone verify", () => {
  it("does not create a user or a session", async () => {
    const store = new MemoryOtpStore();
    const created: string[] = [];
    let otp = "";
    const deps: OtpDeps = {
      now: () => 1_700_000_000_000,
      pepper: "test-pepper-value-32-characters",
      store,
      send: async (_phone, code) => {
        otp = code;
      },
      resolveIdentity: async () => ({ kind: "duplicate" }),
      createUser: async (input) => {
        created.push(input.email);
        return { userId: "new", email: input.email };
      },
      linkIdentity: async () => undefined,
      mint: async () => ({ userId: "new", session: {} }),
      ensureWorkspace: async () => undefined,
    };
    const sent = await requestOtp(deps, {
      phone: "9876543210",
      purpose: "SIGNUP",
      signup: { name: "Priya", businessName: "Priya Stores", email: "priya@example.com" },
      ip: "203.0.113.8",
      userAgent: "vitest",
    });
    await expect(
      verifyOtp(deps, {
        challengeId: sent.challengeId,
        phone: "9876543210",
        purpose: "SIGNUP",
        otp,
        ip: "203.0.113.8",
        userAgent: "vitest",
      })
    ).rejects.toMatchObject({ message: OTP_MESSAGES.duplicatePhone });
    expect(created).toEqual([]);
  });
});
