/**
 * One-off helper. Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD, then:
 *   node scripts/seed-super-admin.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnv(path) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(new URL("../.env.local", import.meta.url));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.SUPER_ADMIN_PASSWORD || "";
if (!url || !service || !email || !password) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD");
  process.exit(1);
}

const supabase = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: "Super Admin" },
});

let userId = created?.user?.id ?? null;
if (createError) {
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    console.error(createError.message);
    process.exit(1);
  }
  const existing = list.users.find((user) => user.email?.toLowerCase() === email);
  if (!existing) {
    console.error(createError.message);
    process.exit(1);
  }
  userId = existing.id;
  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
  });
  if (updateError) {
    console.error(updateError.message);
    process.exit(1);
  }
}

const { error: adminError } = await supabase.from("platform_admins").upsert(
  { user_id: userId, email },
  { onConflict: "email" }
);
if (adminError) {
  console.error(adminError.message);
  process.exit(1);
}

console.log(`Super Admin ready: ${email}`);
