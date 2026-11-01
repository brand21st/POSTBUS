/**
 * Isolated PGlite proof for the shared fixed-window rate limiter.
 * Does not connect to production Supabase.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;

async function hit(key: string, limit: number, windowSeconds = 60) {
  const result = await db.query("select * from hit_rate_limit($1, $2, $3)", [key, limit, windowSeconds]);
  return result.rows[0] as { allowed: boolean; remaining: number };
}

describe("hit_rate_limit", () => {
  beforeAll(async () => {
    db = new PGlite();
    const sql = readFileSync("supabase/migrations/20261023101000_shared_rate_limit.sql", "utf8")
      .split("\n")
      .filter((line) => !/^\s*(revoke|grant)\b/i.test(line))
      .join("\n");
    await db.exec(sql);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("allows up to the limit, then blocks", async () => {
    expect(await hit("shop:a", 2)).toEqual({ allowed: true, remaining: 1 });
    expect(await hit("shop:a", 2)).toEqual({ allowed: true, remaining: 0 });
    expect(await hit("shop:a", 2)).toEqual({ allowed: false, remaining: 0 });
  });

  it("keeps separate counters per key", async () => {
    expect((await hit("shop:b", 1)).allowed).toBe(true);
    expect((await hit("shop:c", 1)).allowed).toBe(true);
  });

  it("starts a new window once the old one expires", async () => {
    await hit("shop:d", 1);
    expect((await hit("shop:d", 1)).allowed).toBe(false);
    await db.query("update rate_limit_buckets set window_start = now() - interval '2 minutes' where key = 'shop:d'");
    expect((await hit("shop:d", 1)).allowed).toBe(true);
  });
});
