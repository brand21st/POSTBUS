import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const tablesSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261009010000_whatsapp_otp_auth.sql"),
  "utf8"
);
const issueSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261009032000_issue_otp_challenge.sql"),
  "utf8"
);

let db: PGlite;

function withoutGrants(sql: string) {
  return sql.replace(/\b(revoke|grant)\b[\s\S]*?;/gi, "");
}

function issue(phone: string, id: string) {
  return db.query<{ issue_otp_challenge: string }>(
    `select public.issue_otp_challenge(
      $1::uuid, $2::text, 'LOGIN', 'hmac',
      now() + interval '5 minutes', now(), 5, null,
      'ip-hash', 'vitest', $3::text, 'ip:shared', now(), 5, 10, 60000
    ) as issue_otp_challenge`,
    [id, phone, `phone:${phone}`]
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
  `);
  await db.exec(withoutGrants(tablesSql));
  await db.exec(withoutGrants(issueSql));
});

afterAll(async () => {
  await db?.close();
});

describe("issue_otp_challenge", () => {
  it("uses a transaction advisory lock", () => {
    expect(issueSql).toContain("pg_advisory_xact_lock");
    expect(issueSql).not.toContain("pg_advisory_lock(");
  });

  it("keeps one pending challenge for ten overlapping requests on one phone", async () => {
    const phone = "+919876543210";
    const ids = Array.from({ length: 10 }, () => crypto.randomUUID());
    const results = await Promise.all(ids.map((id) => issue(phone, id)));
    const outcomes = results.map((result) => result.rows[0]?.issue_otp_challenge);
    expect(outcomes.filter((outcome) => outcome === "issued")).toHaveLength(1);
    const pending = await db.query<{ count: string }>(
      "select count(*)::text as count from public.otp_challenges where phone_e164 = $1 and status = 'pending'",
      [phone]
    );
    expect(pending.rows[0]?.count).toBe("1");
  });

  it("does not block ten different phone numbers", async () => {
    const phones = Array.from({ length: 10 }, (_, index) => `+9198765432${String(index).padStart(2, "0")}`);
    const results = await Promise.all(phones.map((phone) => issue(phone, crypto.randomUUID())));
    expect(results.map((result) => result.rows[0]?.issue_otp_challenge).every((outcome) => outcome === "issued")).toBe(
      true
    );
    const pending = await db.query<{ count: string }>(
      "select count(*)::text as count from public.otp_challenges where status = 'pending' and phone_e164 <> '+919876543210'"
    );
    expect(pending.rows[0]?.count).toBe("10");
  });
});
