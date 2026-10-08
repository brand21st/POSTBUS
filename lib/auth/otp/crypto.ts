import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export function generateOtpDigits() {
  const range = 1_000_000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  let value = randomBytes(4).readUInt32BE(0);
  while (value >= limit) value = randomBytes(4).readUInt32BE(0);
  return String(value % range).padStart(6, "0");
}

export function hashOtp(pepper: string, purpose: string, phone: string, otp: string) {
  return createHmac("sha256", pepper).update(`${purpose}:${phone}:${otp}`).digest("hex");
}

export function otpHmacMatches(expectedHex: string, storedHex: string) {
  if (!/^[0-9a-f]{64}$/i.test(expectedHex) || !/^[0-9a-f]{64}$/i.test(storedHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(storedHex, "hex"));
}

export function hashIp(pepper: string, ip: string) {
  return createHash("sha256").update(`${pepper}:ip:${ip}`).digest("hex");
}

export function phoneLast4(phone: string) {
  return phone.replace(/\D/g, "").slice(-4);
}
