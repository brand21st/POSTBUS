import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { parseLabelTemplate } from "@/modules/labels/template-schema";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260927210000_custom_shipping_label_kind.sql"),
  "utf8"
);

const orgA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orgB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const shipmentA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const orderA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    do $$ begin
      create type public.member_role as enum ('OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER');
    exception when duplicate_object then null;
    end $$;

    create table public.organizations (id uuid primary key, name text not null);
    create table public.organization_members (
      organization_id uuid not null references public.organizations(id) on delete cascade,
      user_id uuid not null,
      role public.member_role not null,
      primary key (organization_id, user_id)
    );

    create or replace function public.is_org_member(org_id uuid)
    returns boolean
    language sql stable security definer set search_path = public as $$
      select exists (
        select 1 from public.organization_members m
        where m.organization_id = org_id and m.user_id = auth.uid()
      );
    $$;

    create or replace function public.has_org_role(org_id uuid, roles public.member_role[])
    returns boolean
    language sql stable security definer set search_path = public as $$
      select exists (
        select 1 from public.organization_members m
        where m.organization_id = org_id and m.user_id = auth.uid() and m.role = any(roles)
      );
    $$;
    create table public.orders (
      id uuid primary key,
      organization_id uuid not null references public.organizations(id) on delete cascade
    );
    create table public.shipments (
      id uuid primary key,
      organization_id uuid not null references public.organizations(id) on delete cascade,
      order_id uuid not null references public.orders(id) on delete cascade
    );
    create table public.labels (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id) on delete cascade,
      shipment_id uuid not null references public.shipments(id) on delete cascade,
      kind text not null default 'INDIA_POST',
      status text not null default 'READY',
      constraint labels_kind_chk check (kind in ('INDIA_POST', 'MERCHANT'))
    );
    create table public.label_templates (
      organization_id uuid primary key references public.organizations(id) on delete cascade,
      template jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    insert into public.organizations (id, name) values
      ('${orgA}', 'Org A'),
      ('${orgB}', 'Org B');
    insert into public.organization_members (organization_id, user_id, role) values
      ('${orgA}', '${userA}', 'OWNER');
    insert into public.orders (id, organization_id) values ('${orderA}', '${orgA}');
    insert into public.shipments (id, organization_id, order_id) values ('${shipmentA}', '${orgA}', '${orderA}');
    insert into public.labels (organization_id, shipment_id, kind) values ('${orgA}', '${shipmentA}', 'INDIA_POST');
    insert into public.labels (organization_id, shipment_id, kind) values ('${orgA}', '${shipmentA}', 'MERCHANT');
    insert into public.label_templates (organization_id, template) values
      ('${orgA}', '{"templateVersion":4,"page":{"paperSize":"A4","widthPt":595,"heightPt":842},"elements":{"orderNumber":{"visible":true,"x":20,"y":700,"width":180,"height":18}}}'::jsonb),
      ('${orgB}', '{"templateVersion":4,"page":{"paperSize":"A4","widthPt":595,"heightPt":842},"elements":{"orderNumber":{"visible":true,"x":10,"y":10,"width":40,"height":12}}}'::jsonb);
  `);
  await db.exec(migration);
});

afterAll(async () => {
  await db.close();
});

describe("custom shipping label database", () => {
  it("allows the custom shipping kind and keeps the existing kinds", async () => {
    await db.query(
      `insert into public.labels (organization_id, shipment_id, kind) values ($1, $2, 'CUSTOM_SHIPPING')`,
      [orgA, shipmentA]
    );
    await expect(
      db.query(`insert into public.labels (organization_id, shipment_id, kind) values ($1, $2, 'OTHER')`, [orgA, shipmentA])
    ).rejects.toMatchObject({ code: "23514" });
    const kinds = await db.query<{ kind: string }>(
      `select kind from public.labels where organization_id = $1 order by kind`,
      [orgA]
    );
    expect(kinds.rows.map((row) => row.kind).sort()).toEqual(["CUSTOM_SHIPPING", "INDIA_POST", "MERCHANT"]);
  });

  it("stores the barcode block in the existing template document", async () => {
    const before = await db.query<{ template: { templateVersion: number } }>(
      `select template from public.label_templates where organization_id = $1`,
      [orgA]
    );
    expect(before.rows[0].template.templateVersion).toBe(4);

    await db.query(`update public.label_templates set template = $2::jsonb where organization_id = $1`, [
      orgA,
      JSON.stringify({
        templateVersion: 5,
        page: { paperSize: "A4", widthPt: 841.89, heightPt: 595.28, widthMm: 297, heightMm: 210 },
        elements: {
          indiaPostBarcode: { visible: true, x: 480, y: 470, width: 320, height: 100, showArticleText: true },
        },
        library: [
          {
            id: "india-post",
            name: "India Post",
            isDefault: true,
            page: { paperSize: "A4", widthPt: 841.89, heightPt: 595.28, widthMm: 297, heightMm: 210 },
            elements: {
              indiaPostBarcode: { visible: true, x: 480, y: 470, width: 320, height: 100 },
            },
          },
        ],
      }),
    ]);
    const stored = await db.query<{ template: unknown }>(
      `select template from public.label_templates where organization_id = $1`,
      [orgA]
    );
    const parsed = parseLabelTemplate(stored.rows[0].template);
    expect(parsed.elements.indiaPostBarcode).toMatchObject({
      visible: true,
      x: 480,
      y: 470,
      width: 320,
      height: 100,
    });
    expect(parsed.library?.[0].name).toBe("India Post");
  });

  it("isolates label templates by organization", async () => {
    await db.exec(`
      alter table public.label_templates enable row level security;
      drop policy if exists label_templates_select on public.label_templates;
      create policy label_templates_select on public.label_templates
        for select using (public.is_org_member(organization_id));
      drop policy if exists label_templates_write on public.label_templates;
      create policy label_templates_write on public.label_templates
        for all using (
          public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
        ) with check (
          public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
        );
      do $$ begin
        create role app_user nologin;
      exception when duplicate_object then null;
      end $$;
      grant usage on schema public to app_user;
      grant select, insert, update, delete on all tables in schema public to app_user;
      grant execute on function public.is_org_member(uuid) to app_user;
      grant execute on function public.has_org_role(uuid, public.member_role[]) to app_user;
    `);
    await db.exec(`select set_config('request.jwt.claim.sub', '${userA}', false)`);
    await db.exec(`set role app_user`);
    const visible = await db.query<{ organization_id: string }>(`select organization_id from public.label_templates`);
    expect(visible.rows.map((row) => row.organization_id)).toEqual([orgA]);
    await db.query(`update public.label_templates set template = '{"hijack":true}'::jsonb where organization_id = $1`, [
      orgB,
    ]);
    await db.exec(`reset role`);
    const other = await db.query<{ template: { hijack?: boolean; templateVersion?: number } }>(
      `select template from public.label_templates where organization_id = $1`,
      [orgB]
    );
    expect(other.rows[0].template.hijack).toBeUndefined();
    expect(other.rows[0].template.templateVersion).toBe(4);
  });
});
