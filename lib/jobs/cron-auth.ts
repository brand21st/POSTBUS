import { timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

export type CronAuthResult = { authorized: true } | { authorized: false; reason: string };

function matches(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function readCronSecret(headers: Headers) {
  const bearer = headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }
  return headers.get("x-cron-secret")?.trim() ?? "";
}

export function authorizeCron(headers: Headers, expected = env.cronSecret): CronAuthResult {
  if (!expected) {
    return {
      authorized: false,
      reason: "CRON_SECRET is not set, so the job runner endpoint is disabled.",
    };
  }

  const provided = readCronSecret(headers);
  if (!provided) {
    return { authorized: false, reason: "Missing cron secret." };
  }
  if (!matches(provided, expected)) {
    return { authorized: false, reason: "Invalid cron secret." };
  }

  return { authorized: true };
}
