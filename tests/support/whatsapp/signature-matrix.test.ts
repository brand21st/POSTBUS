import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyVachatSignature } from "@/modules/vachat/signature";

const secret = "whsec_qa_only";
const body = '{"id":"evt-qa","event":"message.received"}';

function sign(t: number, payload = body) {
  return createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
}

describe("Vachat webhook HMAC matrix", () => {
  it("accepts a current timestamp.rawBody signature", () => {
    const t = 1_700_000_000;
    expect(verifyVachatSignature(`t=${t},v1=${sign(t)}`, body, secret, t)).toBe(true);
  });

  it("rejects missing, invalid, expired, future, and tampered signatures", () => {
    const t = 1_700_000_000;
    const v1 = sign(t);
    expect(verifyVachatSignature("", body, secret, t)).toBe(false);
    expect(verifyVachatSignature(`t=${t},v1=deadbeef`, body, secret, t)).toBe(false);
    expect(verifyVachatSignature(`t=${t},v1=${v1}`, body, secret, t + 301)).toBe(false);
    expect(verifyVachatSignature(`t=${t},v1=${v1}`, body, secret, t - 301)).toBe(false);
    expect(verifyVachatSignature(`t=${t},v1=${v1}`, '{"id":"changed"}', secret, t)).toBe(false);
  });

  it("accepts the 300-second boundary and rejects one second beyond it", () => {
    const t = 1_700_000_000;
    const v1 = sign(t);
    expect(verifyVachatSignature(`t=${t},v1=${v1}`, body, secret, t + 300)).toBe(true);
    expect(verifyVachatSignature(`t=${t},v1=${v1}`, body, secret, t + 301)).toBe(false);
  });
});
