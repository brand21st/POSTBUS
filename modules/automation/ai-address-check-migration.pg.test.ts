/**
 * Applies the AI address-check flag to real Postgres (in-process PGlite).
 * No hosted database is touched.
 *
 * Run: npx vitest run modules/automation/ai-address-check-migration.pg.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const addColumn = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261105120000_auto_ai_address_check.sql"),
  "utf8"
);
const defaultOff = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261106120000_auto_ai_address_check_default_off.sql"),
  "utf8"
);

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.automation_settings (
      organization_id uuid primary key
    );
  `);
  await db.exec(addColumn);
  await db.exec(defaultOff);
});

afterAll(async () => {
  await db?.close();
});

describe("AI address check migration", () => {
  it("defaults auto_ai_address_check to false for new and existing workspaces", async () => {
    const columns = await db.query<{ column_name: string; column_default: string | null; is_nullable: string }>(
      `select column_name, column_default, is_nullable from information_schema.columns
        where table_name = 'automation_settings' and column_name = 'auto_ai_address_check'`
    );
    expect(columns.rows).toHaveLength(1);
    expect(columns.rows[0]?.column_default).toBe("false");
    expect(columns.rows[0]?.is_nullable).toBe("NO");

    const org = "11111111-1111-4111-8111-111111111111";
    await db.query("insert into public.automation_settings (organization_id) values ($1)", [org]);
    const inserted = await db.query<{ auto_ai_address_check: boolean }>(
      "select auto_ai_address_check from public.automation_settings where organization_id = $1",
      [org]
    );
    expect(inserted.rows[0]?.auto_ai_address_check).toBe(false);

    await db.query("update public.automation_settings set auto_ai_address_check = true where organization_id = $1", [
      org,
    ]);
    await db.exec(defaultOff);
    const reset = await db.query<{ auto_ai_address_check: boolean }>(
      "select auto_ai_address_check from public.automation_settings where organization_id = $1",
      [org]
    );
    expect(reset.rows[0]?.auto_ai_address_check).toBe(false);
  });
});
