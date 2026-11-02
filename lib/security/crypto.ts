import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";
import { env } from "@/lib/env";

const ALGO = "aes-256-gcm";
const DEV_FALLBACK_KEY = "dev-only-change-me-32-bytes-min!!";

function encryptionSecret() {
  if (env.encryptionKey) return env.encryptionKey;
  if (process.env.NODE_ENV === "production") {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is required in production.");
  }
  return DEV_FALLBACK_KEY;
}

function keyBytes() {
  return scryptSync(encryptionSecret(), "postbus-integrations", 32);
}

export function encryptSecret(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string) {
  const [iv, tag, data] = payload.split(".");
  if (!iv || !tag || !data) {
    throw new Error("Invalid encrypted payload.");
  }
  const decipher = createDecipheriv(ALGO, keyBytes(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(value: string) {
  return createHmac("sha256", encryptionSecret()).update(value).digest("hex");
}

/** Current integration key, then any retained previous keys. Verification tries each. */
export function bookingProofSecrets(): string[] {
  const configured = (process.env.INTEGRATION_ENCRYPTION_KEY || "").trim();
  const current = configured || encryptionSecret();
  const previous = (process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item !== current);
  return [current, ...previous];
}

/** Identifier stored with a proof. Not the secret. */
export function bookingProofKeyId(secret: string) {
  return createHash("sha256").update(`postbus.booking-proof-key.v1\0${secret}`).digest("hex").slice(0, 16);
}

export function hmacSha256Digest(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest();
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function maskSecret(value?: string | null) {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}
