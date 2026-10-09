/**
 * Real PostgreSQL RLS + composite FK proof for Support Center.
 * Uses in-process PGlite. Does not connect to production (hgacoeoovjxkzfbesmvl)
 * or any hosted Supabase project.
 *
 * JWT claims used: request.jwt.claim.sub (auth.uid), request.jwt.claim.role.
 * The merchant session is SET ROLE authenticated — not table owner, not service_role.
 *
 * Run: npx vitest run modules/support/rls.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const USER_VIEWER = "33333333-3333-3333-3333-333333333333";
const ORDER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORDER_B = "bbbbbbbb-0000-0000-0000-000000000001";
const CONV_A = "aaaaaaaa-cccc-0000-0000-000000000001";
const CONV_B = "bbbbbbbb-cccc-0000-0000-000000000001";
const TKT_A = "aaaaaaaa-dddd-0000-0000-000000000001";
const TKT_B = "bbbbbbbb-dddd-0000-0000-000000000001";
const MSG_A = "aaaaaaaa-eeee-0000-0000-000000000001";
const MSG_B = "bbbbbbbb-eeee-0000-0000-000000000001";
const ATT_B = "bbbbbbbb-ffff-0000-0000-000000000001";
const CH_A = "aaaaaaaa-9999-0000-0000-000000000001";
const CH_B = "bbbbbbbb-9999-0000-0000-000000000001";
const QUEUE = "99999999-0000-0000-0000-000000000001";

let db: PGlite;

async function asUser(userId: string, sql: string, params: unknown[] = []) {
  await db.query("begin");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await db.query("select set_config('request.jwt.claim.role', $1, true)", ["authenticated"]);
  await db.query("set local role authenticated");
  try {
    const result = await db.query(sql, params);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

describe("Support Center two-tenant PostgreSQL RLS", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid
      language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.role() returns text
      language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
      $$;

      do $$ begin
        create type public.member_role as enum ('OWNER','ADMIN','MANAGER','OPERATOR','VIEWER');
      exception when duplicate_object then null; end $$;

      create table public.organizations (id uuid primary key, name text);
      create table public.organization_members (
        organization_id uuid not null references public.organizations(id),
        user_id uuid not null,
        role public.member_role not null,
        primary key (organization_id, user_id)
      );
      create or replace function public.is_org_member(p_org uuid) returns boolean
      language sql stable security definer set search_path = public as $$
        select exists (
          select 1 from public.organization_members
          where organization_id = p_org and user_id = auth.uid()
        );
      $$;
      create or replace function public.has_org_role(p_org uuid, p_roles public.member_role[]) returns boolean
      language sql stable security definer set search_path = public as $$
        select exists (
          select 1 from public.organization_members
          where organization_id = p_org and user_id = auth.uid() and role = any (p_roles)
        );
      $$;

      create table public.orders (
        id uuid not null,
        organization_id uuid not null references public.organizations(id),
        primary key (id)
      );
      alter table public.orders add constraint orders_id_organization_id_key unique (id, organization_id);

      create table public.support_channels (
        id uuid primary key,
        organization_id uuid not null references public.organizations(id)
      );
      create table public.support_conversations (
        id uuid primary key,
        organization_id uuid not null references public.organizations(id),
        channel_id uuid not null references public.support_channels(id),
        phone_digits text not null
      );
      create table public.support_tickets (
        id uuid primary key,
        organization_id uuid not null references public.organizations(id),
        conversation_id uuid not null references public.support_conversations(id),
        order_id uuid,
        assigned_to uuid,
        public_number text not null,
        status text not null default 'open'
      );
      alter table public.support_tickets
        add constraint support_tickets_order_org_fk
        foreign key (order_id, organization_id) references public.orders (id, organization_id);
      create table public.support_messages (
        id uuid primary key,
        organization_id uuid not null references public.organizations(id),
        conversation_id uuid not null references public.support_conversations(id),
        body text
      );
      create table public.support_message_attachments (
        id uuid primary key,
        organization_id uuid not null references public.organizations(id),
        message_id uuid not null references public.support_messages(id)
      );
      create table public.support_unassigned_threads (
        id uuid primary key,
        phone_digits text not null
      );

      insert into public.organizations values ('${ORG_A}', 'A'), ('${ORG_B}', 'B');
      insert into public.organization_members values
        ('${ORG_A}', '${USER_A}', 'OWNER'),
        ('${ORG_A}', '${USER_VIEWER}', 'VIEWER'),
        ('${ORG_B}', '${USER_B}', 'OWNER');
      insert into public.orders values ('${ORDER_A}', '${ORG_A}'), ('${ORDER_B}', '${ORG_B}');
      insert into public.support_channels values ('${CH_A}', '${ORG_A}'), ('${CH_B}', '${ORG_B}');
      insert into public.support_conversations values
        ('${CONV_A}', '${ORG_A}', '${CH_A}', '9000000001'),
        ('${CONV_B}', '${ORG_B}', '${CH_B}', '9000000002');
      insert into public.support_tickets values
        ('${TKT_A}', '${ORG_A}', '${CONV_A}', '${ORDER_A}', null, 'PB-TKT-A', 'open'),
        ('${TKT_B}', '${ORG_B}', '${CONV_B}', '${ORDER_B}', null, 'PB-TKT-B', 'open');
      insert into public.support_messages values
        ('${MSG_A}', '${ORG_A}', '${CONV_A}', 'hello A'),
        ('${MSG_B}', '${ORG_B}', '${CONV_B}', 'hello B');
      insert into public.support_message_attachments values ('${ATT_B}', '${ORG_B}', '${MSG_B}');
      insert into public.support_unassigned_threads values ('${QUEUE}', '9000000009');

      alter table public.support_tickets enable row level security;
      alter table public.support_tickets force row level security;
      alter table public.support_conversations enable row level security;
      alter table public.support_conversations force row level security;
      alter table public.support_messages enable row level security;
      alter table public.support_messages force row level security;
      alter table public.support_message_attachments enable row level security;
      alter table public.support_message_attachments force row level security;
      alter table public.support_unassigned_threads enable row level security;
      alter table public.support_unassigned_threads force row level security;

      create policy support_tickets_select on public.support_tickets
        for select using (public.is_org_member(organization_id));
      create policy support_tickets_write on public.support_tickets
        for all using (
          public.has_org_role(organization_id, array['OWNER','ADMIN','MANAGER','OPERATOR']::public.member_role[])
        ) with check (
          public.has_org_role(organization_id, array['OWNER','ADMIN','MANAGER','OPERATOR']::public.member_role[])
        );
      create policy support_conversations_select on public.support_conversations
        for select using (public.is_org_member(organization_id));
      create policy support_messages_select on public.support_messages
        for select using (public.is_org_member(organization_id));
      create policy support_attachments_select on public.support_message_attachments
        for select using (public.is_org_member(organization_id));

      revoke all on public.support_tickets from public;
      revoke all on public.support_conversations from public;
      revoke all on public.support_messages from public;
      revoke all on public.support_message_attachments from public;
      revoke all on public.support_unassigned_threads from public;

      do $$ begin
        create role authenticated nologin;
      exception when duplicate_object then null; end $$;
      grant usage on schema public to authenticated;
      grant select, insert, update, delete on public.support_tickets to authenticated;
      grant select, update on public.support_conversations to authenticated;
      grant select, insert, update on public.support_messages to authenticated;
      grant select, insert on public.support_message_attachments to authenticated;
    `);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("rejects a ticket whose order belongs to another organization", async () => {
    await expect(
      db.query(
        `insert into public.support_tickets (id, organization_id, conversation_id, order_id, public_number)
         values ('aaaaaaaa-dddd-0000-0000-000000000099'::uuid, $1, $2, $3, 'PB-TKT-X')`,
        [ORG_A, CONV_A, ORDER_B]
      )
    ).rejects.toThrow();
  });

  it("Merchant A cannot read Merchant B tickets, conversations, messages, or attachments", async () => {
    const tickets = await asUser(USER_A, "select id from public.support_tickets");
    expect(tickets.rows.map((row) => String(row.id))).toEqual([TKT_A]);
    const conv = await asUser(USER_A, "select id from public.support_conversations");
    expect(conv.rows.map((row) => String(row.id))).toEqual([CONV_A]);
    const msgs = await asUser(USER_A, "select id from public.support_messages");
    expect(msgs.rows.map((row) => String(row.id))).toEqual([MSG_A]);
    const atts = await asUser(USER_A, "select id from public.support_message_attachments");
    expect(atts.rows).toEqual([]);
  });

  it("Merchant B cannot read or update Merchant A tickets", async () => {
    const tickets = await asUser(USER_B, "select id from public.support_tickets");
    expect(tickets.rows.map((row) => String(row.id))).toEqual([TKT_B]);
    const updated = await asUser(
      USER_B,
      "update public.support_tickets set status = 'closed' where id = $1 returning id",
      [TKT_A]
    );
    expect(updated.rows).toEqual([]);
  });

  it("Merchant A cannot delete Merchant B tickets or attach Merchant B orders", async () => {
    const deleted = await asUser(USER_A, "delete from public.support_tickets where id = $1 returning id", [TKT_B]);
    expect(deleted.rows).toEqual([]);
    await expect(
      asUser(
        USER_A,
        "update public.support_tickets set order_id = $1 where id = $2 returning id",
        [ORDER_B, TKT_A]
      )
    ).rejects.toThrow();
  });

  it("VIEWER can read own-org tickets but cannot update them", async () => {
    const read = await asUser(USER_VIEWER, "select id from public.support_tickets");
    expect(read.rows.map((row) => String(row.id))).toEqual([TKT_A]);
    const write = await asUser(
      USER_VIEWER,
      "update public.support_tickets set assigned_to = $1 where id = $2 returning id",
      [USER_VIEWER, TKT_A]
    );
    expect(write.rows).toEqual([]);
  });

  it("Owner can update own-org assignment and merchants cannot read the Super Admin queue", async () => {
    const assigned = await asUser(
      USER_A,
      "update public.support_tickets set assigned_to = $1 where id = $2 returning id",
      [USER_A, TKT_A]
    );
    expect(assigned.rows).toHaveLength(1);
    await expect(asUser(USER_A, "select id from public.support_unassigned_threads")).rejects.toThrow();
  });
});
