import { readFileSync } from "fs";
import { describe, expect, it, vi } from "vitest";
import { applyOtpAttempt, type OtpChallengeRow } from "@/lib/auth/otp/attempt";
import { hashOtp, otpHmacMatches } from "@/lib/auth/otp/crypto";
import { isWhatsappOtpEnabled } from "@/lib/auth/otp/flags";
import { MemoryOtpStore } from "@/lib/auth/otp/memory-store";
import { OTP_MESSAGES, bucketAllows, sendWindowStart } from "@/lib/auth/otp/policy";
import { requestOtp, verifyOtp, type OtpDeps, type PhoneIdentity } from "@/lib/auth/otp/service";
import { whatsappAuthUserPayload } from "@/lib/auth/identity/phone";
import { AppError } from "@/lib/api/errors";

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

const PHONE = "9876543210";
const E164 = "+919876543210";
const PEPPER = "test-pepper-value-32-characters";

function blankRow(overrides: Partial<OtpChallengeRow> = {}): OtpChallengeRow {
  return {
    id: "c1",
    phoneE164: E164,
    purpose: "LOGIN",
    otpHmac: "ab".repeat(32),
    expiresAtMs: 1_000_000,
    attemptCount: 0,
    maxAttempts: 5,
    lastSentAtMs: 0,
    verifiedAtMs: null,
    status: "pending",
    signupPayload: null,
    createdAtMs: 0,
    ...overrides,
  };
}

function harness(now = { value: 1_700_000_000_000 }) {
  const store = new MemoryOtpStore();
  const sent: string[] = [];
  const created: string[] = [];
  const workspaces: Array<string | null> = [];
  let identity: PhoneIdentity = { kind: "none" };
  let mintFailures = 0;
  const deps: OtpDeps = {
    now: () => now.value,
    pepper: PEPPER,
    store,
    send: async (_phone, otp) => {
      sent.push(otp);
    },
    resolveIdentity: async () => identity,
    createUser: async (input) => {
      created.push(input.email);
      identity = { kind: "unique", userId: "user-1", email: input.email };
      return { userId: "user-1", email: input.email };
    },
    linkIdentity: async () => undefined,
    mint: async () => {
      if (mintFailures > 0) {
        mintFailures -= 1;
        throw new Error("SESSION_FAILED");
      }
      return { userId: "user-1", session: { ok: true } };
    },
    ensureWorkspace: async (input) => {
      workspaces.push(input.workspaceName);
    },
  };
  return {
    deps,
    store,
    sent,
    created,
    workspaces,
    now,
    setIdentity: (next: PhoneIdentity) => {
      identity = next;
    },
    failNextMints: (count: number) => {
      mintFailures = count;
    },
  };
}

async function issuedCode(box: ReturnType<typeof harness>, purpose: "LOGIN" | "SIGNUP" = "LOGIN", signup?: { name: string; businessName: string; email: string }) {
  const result = await requestOtp(box.deps, {
    phone: PHONE,
    purpose,
    signup: signup ?? null,
    ip: "203.0.113.8",
    userAgent: "vitest",
  });
  return { ...result, otp: box.sent.at(-1) ?? "" };
}

describe("otp policy", () => {
  it("hashes purpose, phone, and code and compares in constant time", () => {
    const hmac = hashOtp(PEPPER, "LOGIN", E164, "123456");
    expect(hmac).toHaveLength(64);
    expect(otpHmacMatches(hmac, hmac)).toBe(true);
    expect(otpHmacMatches(hashOtp(PEPPER, "SIGNUP", E164, "123456"), hmac)).toBe(false);
  });

  it("locks a challenge on the fifth wrong code and rejects the sixth", () => {
    let row = blankRow();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const next = applyOtpAttempt(row, 10, false);
      expect(next.outcome).toBe("mismatch");
      row = next.row!;
    }
    expect(row.status).toBe("invalidated");
    expect(applyOtpAttempt(row, 10, true).outcome).toBe("locked");
  });

  it("counts sends inside a 15 minute window", () => {
    const start = sendWindowStart(1_000_000);
    expect(sendWindowStart(start.getTime() + 60_000).toISOString()).toBe(start.toISOString());
    expect(bucketAllows(5, 5)).toBe(true);
    expect(bucketAllows(6, 5)).toBe(false);
  });

  it("keeps the feature flag off unless explicitly enabled", () => {
    const previous = process.env.AUTH_WHATSAPP_OTP_ENABLED;
    delete process.env.AUTH_WHATSAPP_OTP_ENABLED;
    expect(isWhatsappOtpEnabled()).toBe(false);
    process.env.AUTH_WHATSAPP_OTP_ENABLED = "true";
    expect(isWhatsappOtpEnabled()).toBe(true);
    if (previous == null) delete process.env.AUTH_WHATSAPP_OTP_ENABLED;
    else process.env.AUTH_WHATSAPP_OTP_ENABLED = previous;
  });

  it("confirms the phone and leaves email unconfirmed", () => {
    const payload = whatsappAuthUserPayload({
      email: "Merchant@Example.com",
      phoneE164: E164,
      fullName: "Priya",
    });
    expect(payload.email_confirm).toBe(false);
    expect(payload.phone_confirm).toBe(true);
    expect(payload.phone).toBe(E164);
    expect(payload.user_metadata.whatsapp_number).toBe(E164);
    expect(payload.password.length).toBeGreaterThan(20);
  });
});

describe("otp requests and verification", () => {
  it("returns the same sent shape for a new and an existing number", async () => {
    const first = harness();
    const login = await issuedCode(first, "LOGIN");
    const second = harness();
    second.setIdentity({ kind: "unique", userId: "user-9", email: "old@example.com" });
    const signup = await issuedCode(second, "SIGNUP", {
      name: "Priya",
      businessName: "Priya Stores",
      email: "priya@example.com",
    });
    expect(login.status).toBe("sent");
    expect(signup.status).toBe("sent");
    expect(login.challengeId).toEqual(expect.any(String));
    expect(signup.challengeId).toEqual(expect.any(String));
    expect(first.deps.resolveIdentity).toBeTypeOf("function");
    expect(JSON.stringify(first.store.audits)).not.toContain(E164);
    expect(JSON.stringify(first.store.audits)).not.toContain(login.otp);
  });

  it("does not look up an account before the code is sent", async () => {
    const box = harness();
    const resolve = vi.fn(async () => ({ kind: "none" as const }));
    box.deps.resolveIdentity = resolve;
    await issuedCode(box);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("invalidates the previous code on resend and expires old codes", async () => {
    const box = harness();
    const first = await issuedCode(box);
    box.now.value += 61_000;
    const second = await issuedCode(box);
    await expect(
      verifyOtp(box.deps, { challengeId: first.challengeId, phone: PHONE, purpose: "LOGIN", otp: first.otp, ip: "203.0.113.8", userAgent: "vitest" })
    ).rejects.toBeInstanceOf(AppError);
    const pending = await verifyOtp(box.deps, {
      challengeId: second.challengeId,
      phone: PHONE,
      purpose: "LOGIN",
      otp: second.otp,
      ip: "203.0.113.8",
      userAgent: "vitest",
    });
    expect(pending.status).toBe("complete_profile");
  });

  it("rejects a second use after the code is consumed", async () => {
    const box = harness();
    box.setIdentity({ kind: "unique", userId: "user-1", email: "priya@example.com" });
    const issued = await issuedCode(box);
    const ok = await verifyOtp(box.deps, {
      challengeId: issued.challengeId,
      phone: PHONE,
      purpose: "LOGIN",
      otp: issued.otp,
      ip: "203.0.113.8",
      userAgent: "vitest",
    });
    expect(ok.status).toBe("authenticated");
    await expect(
      verifyOtp(box.deps, {
        challengeId: issued.challengeId,
        phone: PHONE,
        purpose: "LOGIN",
        otp: issued.otp,
        ip: "203.0.113.8",
        userAgent: "vitest",
      })
    ).rejects.toMatchObject({ message: OTP_MESSAGES.invalid });
  });

  it("locks after five wrong codes", async () => {
    const box = harness();
    const issued = await issuedCode(box);
    const wrong = issued.otp === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        verifyOtp(box.deps, {
          challengeId: issued.challengeId,
          phone: PHONE,
          purpose: "LOGIN",
          otp: wrong,
          ip: "203.0.113.8",
          userAgent: "vitest",
        })
      ).rejects.toMatchObject({ message: OTP_MESSAGES.invalid });
    }
    await expect(
      verifyOtp(box.deps, {
        challengeId: issued.challengeId,
        phone: PHONE,
        purpose: "LOGIN",
        otp: issued.otp,
        ip: "203.0.113.8",
        userAgent: "vitest",
      })
    ).rejects.toMatchObject({ message: OTP_MESSAGES.locked });
  });

  it("waits on the sixth send inside the window", async () => {
    const box = harness({ value: sendWindowStart(1_700_000_000_000).getTime() });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) box.now.value += 61_000;
      await issuedCode(box);
    }
    box.now.value += 61_000;
    await expect(issuedCode(box)).rejects.toMatchObject({ message: OTP_MESSAGES.wait });
  });

  it("refuses duplicate phones and does not create a second account for a mapped number", async () => {
    const duplicate = harness();
    duplicate.setIdentity({ kind: "duplicate" });
    const issued = await issuedCode(duplicate);
    await expect(
      verifyOtp(duplicate.deps, {
        challengeId: issued.challengeId,
        phone: PHONE,
        purpose: "LOGIN",
        otp: issued.otp,
        ip: "203.0.113.8",
        userAgent: "vitest",
      })
    ).rejects.toMatchObject({ message: OTP_MESSAGES.duplicatePhone });

    const existing = harness();
    existing.setIdentity({ kind: "unique", userId: "user-1", email: "priya@example.com" });
    const signup = await issuedCode(existing, "SIGNUP", {
      name: "Other",
      businessName: "Other Stores",
      email: "other@example.com",
    });
    const signedIn = await verifyOtp(existing.deps, {
      challengeId: signup.challengeId,
      phone: PHONE,
      purpose: "SIGNUP",
      otp: signup.otp,
      profile: { name: "Swapped", businessName: "Swapped", email: "swapped@example.com" },
      ip: "203.0.113.8",
      userAgent: "vitest",
    });
    expect(signedIn.status).toBe("authenticated");
    expect(existing.created).toEqual([]);
    expect(existing.workspaces).toEqual(["Other Stores"]);
  });

  it("does not create a user when identity lookup fails or the auth email is missing", async () => {
    for (const reason of ["LOOKUP_FAILED", "MISSING_EMAIL"] as const) {
      const box = harness();
      box.setIdentity({ kind: "error", reason });
      const issued = await issuedCode(box, "SIGNUP", {
        name: "Priya",
        businessName: "Priya Stores",
        email: "priya@example.com",
      });
      await expect(
        verifyOtp(box.deps, {
          challengeId: issued.challengeId,
          phone: PHONE,
          purpose: "SIGNUP",
          otp: issued.otp,
          ip: "203.0.113.8",
          userAgent: "vitest",
        })
      ).rejects.toMatchObject({ message: OTP_MESSAGES.duplicatePhone });
      expect(box.created).toEqual([]);
      expect(box.workspaces).toEqual([]);
    }
  });

  it("binds signup to the server payload and retries mint without creating again", async () => {
    const box = harness();
    box.failNextMints(1);
    const issued = await issuedCode(box, "SIGNUP", {
      name: "Priya",
      businessName: "Priya Stores",
      email: "priya@example.com",
    });
    await expect(
      verifyOtp(box.deps, {
        challengeId: issued.challengeId,
        phone: PHONE,
        purpose: "SIGNUP",
        otp: issued.otp,
        profile: { name: "Nope", businessName: "Nope", email: "nope@example.com" },
        ip: "203.0.113.8",
        userAgent: "vitest",
      })
    ).rejects.toMatchObject({ message: OTP_MESSAGES.signInFailed });
    expect(box.created).toEqual(["priya@example.com"]);
    const again = await verifyOtp(box.deps, {
      challengeId: issued.challengeId,
      phone: PHONE,
      purpose: "SIGNUP",
      ip: "203.0.113.8",
      userAgent: "vitest",
    });
    expect(again.status).toBe("authenticated");
    expect(box.created).toEqual(["priya@example.com"]);
    expect(box.workspaces).toEqual(["Priya Stores"]);
  });

  it("does not keep a live code when WhatsApp sending fails", async () => {
    const box = harness();
    box.deps.send = async () => {
      throw new Error("provider down");
    };
    await expect(issuedCode(box)).rejects.toMatchObject({ message: OTP_MESSAGES.sendFailed });
    expect(box.store.challenges[0]?.status).toBe("invalidated");
  });

  it("returns a generic failure when the email is already registered", async () => {
    const box = harness();
    box.deps.createUser = async () => {
      throw new Error("EMAIL_TAKEN");
    };
    const issued = await issuedCode(box, "SIGNUP", {
      name: "Priya",
      businessName: "Priya Stores",
      email: "priya@example.com",
    });
    await expect(
      verifyOtp(box.deps, {
        challengeId: issued.challengeId,
        phone: PHONE,
        purpose: "SIGNUP",
        otp: issued.otp,
        ip: "203.0.113.8",
        userAgent: "vitest",
      })
    ).rejects.toMatchObject({ message: OTP_MESSAGES.duplicateEmail });
  });

  it("leaves one pending challenge when ten requests overlap on the same phone", async () => {
    const box = harness();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        requestOtp(box.deps, {
          phone: PHONE,
          purpose: "LOGIN",
          ip: "203.0.113.8",
          userAgent: "vitest",
        })
      )
    );
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(box.store.challenges.filter((row) => row.status === "pending")).toHaveLength(1);
    expect(box.sent).toHaveLength(1);
  });

  it("issues one challenge per phone when ten different numbers overlap", async () => {
    const box = harness();
    const phones = Array.from({ length: 10 }, (_, index) => `98765432${String(index).padStart(2, "0")}`);
    const results = await Promise.allSettled(
      phones.map((phone) =>
        requestOtp(box.deps, {
          phone,
          purpose: "LOGIN",
          ip: "203.0.113.9",
          userAgent: "vitest",
        })
      )
    );
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(10);
    expect(box.store.challenges.filter((row) => row.status === "pending")).toHaveLength(10);
  });

  it("lets only one of two overlapping verifications create a session", async () => {
    const box = harness();
    box.setIdentity({ kind: "unique", userId: "user-1", email: "priya@example.com" });
    const issued = await issuedCode(box);
    let sessions = 0;
    box.deps.mint = async () => {
      sessions += 1;
      return { userId: "user-1", session: { ok: true } };
    };
    const results = await Promise.allSettled([
      verifyOtp(box.deps, {
        challengeId: issued.challengeId,
        phone: PHONE,
        purpose: "LOGIN",
        otp: issued.otp,
        ip: "203.0.113.8",
        userAgent: "vitest",
      }),
      verifyOtp(box.deps, {
        challengeId: issued.challengeId,
        phone: PHONE,
        purpose: "LOGIN",
        otp: issued.otp,
        ip: "203.0.113.8",
        userAgent: "vitest",
      }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(sessions).toBe(1);
    expect(box.created).toEqual([]);
  });
});

describe("otp migration and client boundaries", () => {
  it("does not unique-index profile phones and locks the otp tables to service role", () => {
    const sql = readFileSync("supabase/migrations/20261009010000_whatsapp_otp_auth.sql", "utf8");
    expect(sql).toContain("revoke all on table public.otp_challenges from public, anon, authenticated");
    expect(sql).toContain("grant all on table public.phone_identities to service_role");
    expect(sql).toContain("intentionally NOT unique");
    expect(sql).not.toMatch(/create unique index[^;]*whatsapp_number/i);
  });

  it("keeps password sign-in and does not send OTP as session text", () => {
    const login = readFileSync("app/(auth)/login/login-form.tsx", "utf8");
    const sender = readFileSync("lib/auth/otp/send-whatsapp.ts", "utf8");
    expect(login).toContain("signInWithPassword");
    expect(login).not.toContain("OTP_PEPPER");
    expect(sender).not.toContain("sendVachatSessionText");
    expect(sender.toLowerCase()).not.toContain("wati");
  });
});
