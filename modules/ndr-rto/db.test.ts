import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIndiaPostRoutingView } from "@/lib/dashboard/india-post-routing";
import { applyIndiaPostTracking, type ShipmentTrackingSnapshot } from "@/modules/india-post/apply-tracking";
import { parseIndiaPostWebhook } from "@/modules/india-post/webhook-parser";
import type { TrackingEvent } from "@/types/api";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260927140000_ndr_rto.sql"),
  "utf8"
);

let db: PGlite;
let orgA: string;
let orgB: string;
let userA: string;
let shipmentA: string;

function client(): SupabaseClient {
  return {
    from(table: string) {
      const state: { patch?: Record<string, unknown>; filters: Array<[string, unknown]> } = { filters: [] };
      const api = {
        insert(row: Record<string, unknown>) {
          const columns = Object.keys(row);
          const values = columns.map((column) => (column === "raw" ? JSON.stringify(row[column]) : row[column]));
          const placeholders = columns.map((column, index) => (column === "raw" ? `$${index + 1}::jsonb` : `$${index + 1}`));
          return db
            .query(
              `insert into public.${table} (${columns.join(", ")}) values (${placeholders.join(", ")})`,
              values
            )
            .then(
              () => ({ error: null }),
              (error: { code?: string; message?: string }) => ({
                error: { code: error.code ?? "ERROR", message: error.message ?? "insert failed" },
              })
            );
        },
        update(patch: Record<string, unknown>) {
          state.patch = patch;
          return api;
        },
        eq(column: string, value: unknown) {
          state.filters.push([column, value]);
          return api;
        },
        then(resolve: (value: { error: { code?: string; message: string } | null }) => void, reject: (error: unknown) => void) {
          this.run().then(resolve, reject);
        },
        async run() {
          if (!state.patch) return { error: null };
          const columns = Object.keys(state.patch);
          const values = columns.map((column) => state.patch?.[column]);
          const where = state.filters
            .map(([column], index) => `${column} = $${columns.length + index + 1}`)
            .join(" and ");
          try {
            await db.query(
              `update public.${table} set ${columns.map((column, index) => `${column} = $${index + 1}`).join(", ")} where ${where}`,
              [...values, ...state.filters.map(([, value]) => value)]
            );
            return { error: null };
          } catch (error) {
            const pg = error as { code?: string; message?: string };
            return { error: { code: pg.code, message: pg.message ?? "update failed" } };
          }
        },
      };
      return api;
    },
  } as unknown as SupabaseClient;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    do $$ begin
      create type public.shipment_status as enum (
        'DRAFT','VALIDATING','QUEUED','BOOKING','BOOKED','LABEL_PENDING','LABEL_READY',
        'MANIFEST_PENDING','MANIFEST_READY','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED',
        'FAILED','CANCELLED','RTO'
      );
    exception when duplicate_object then null;
    end $$;

    do $$ begin
      create type public.order_status as enum (
        'IMPORTED','READY','PROCESSING','BOOKED','SHIPPED','IN_TRANSIT','DELIVERED','FAILED','CANCELLED'
      );
    exception when duplicate_object then null;
    end $$;

    create table public.organizations (
      id uuid primary key default gen_random_uuid(),
      name text not null
    );

    create table public.organization_members (
      organization_id uuid not null references public.organizations(id) on delete cascade,
      user_id uuid not null,
      primary key (organization_id, user_id)
    );

    create table public.orders (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id) on delete cascade,
      order_number text not null,
      status public.order_status not null default 'BOOKED',
      total_amount numeric(12,2) not null default 0
    );

    create table public.shipments (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id) on delete cascade,
      order_id uuid not null references public.orders(id) on delete cascade,
      weight_grams integer not null,
      barcode text,
      tracking_number text,
      status public.shipment_status not null default 'BOOKED',
      created_at timestamptz not null default now()
    );

    create table public.tracking_events (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id) on delete cascade,
      shipment_id uuid not null references public.shipments(id) on delete cascade,
      event_code text not null,
      event_description text,
      office_name text,
      office_id text,
      occurred_at timestamptz not null,
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create unique index tracking_events_dedupe_uidx
      on public.tracking_events (organization_id, shipment_id, event_code, occurred_at);
  `);
  await db.exec(migration);

  const orgs = await db.query<{ id: string }>(
    `insert into public.organizations (name) values ('Workspace A'), ('Workspace B') returning id`
  );
  orgA = orgs.rows[0].id;
  orgB = orgs.rows[1].id;
  userA = "11111111-1111-4111-8111-111111111111";
  await db.query(`insert into public.organization_members (organization_id, user_id) values ($1, $2)`, [orgA, userA]);

  const order = await db.query<{ id: string }>(
    `insert into public.orders (organization_id, order_number, total_amount) values ($1, 'PB-1001', 499) returning id`,
    [orgA]
  );
  const shipment = await db.query<{ id: string }>(
    `insert into public.shipments (organization_id, order_id, weight_grams, barcode, tracking_number, status)
     values ($1, $2, 500, 'AW784699994IN', 'AW784699994IN', 'IN_TRANSIT') returning id`,
    [orgA, order.rows[0].id]
  );
  shipmentA = shipment.rows[0].id;

  const orderB = await db.query<{ id: string }>(
    `insert into public.orders (organization_id, order_number) values ($1, 'PB-9') returning id`,
    [orgB]
  );
  await db.query(
    `insert into public.shipments (organization_id, order_id, weight_grams, barcode, status, operational_status)
     values ($1, $2, 200, 'ET000000015IN', 'NDR', 'NDR')`,
    [orgB, orderB.rows[0].id]
  );
});

afterAll(async () => {
  await db.close();
});

describe("NDR RTO database migration", () => {
  it("applies operational columns, the NDR status, and lookup indexes", async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'shipments'
         and column_name in ('operational_status', 'ndr_attempt_count', 'rto_initiated_at', 'delivered_at', 'last_tracked_at')`
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual([
      "delivered_at",
      "last_tracked_at",
      "ndr_attempt_count",
      "operational_status",
      "rto_initiated_at",
    ]);

    const indexes = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes
       where schemaname = 'public'
         and indexname in ('shipments_org_operational_idx', 'shipments_org_delivered_at_idx', 'tracking_events_dedupe_uidx')`
    );
    expect(indexes.rows).toHaveLength(3);

    await expect(
      db.query(
        `insert into public.shipments (organization_id, order_id, weight_grams, status, operational_status)
         values ($1, (select id from public.orders where organization_id = $1 limit 1), 100, 'BOOKED', 'NOT_A_STATUS')`,
        [orgA]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("stores an NDR event once, updates the shipment, and rejects a duplicate scan", async () => {
    const parsed = parseIndiaPostWebhook(
      JSON.stringify({
        article_number: "AW784699994IN",
        event_code: "DELIVERY_ATTEMPTED",
        event_description: "Delivery attempted",
        event_date: "2026-09-27",
        event_time: "10:15:00",
        event_office_name: "Pandhana S.O",
        event_office_facility_id: "23660808",
        non_delivery_reason: "Addressee cannot be located",
      }),
      "application/json",
      "events"
    );
    const current = snapshot();
    const applied = await applyIndiaPostTracking(client(), current, {
      eventCode: parsed.eventCode || "EVENT",
      eventDescription: parsed.eventDescription,
      officeName: parsed.officeName,
      officeId: parsed.officeId,
      occurredAt: parsed.eventTimestamp || "2026-09-27T10:15:00.000Z",
      raw: parsed.rawPayload,
      nonDeliveryReason: parsed.nonDeliveryReason,
    });
    expect(applied.snapshot.status).toBe("NDR");
    expect(applied.snapshot.ndrAttemptCount).toBe(1);

    const again = await applyIndiaPostTracking(client(), applied.snapshot, {
      eventCode: parsed.eventCode || "EVENT",
      eventDescription: parsed.eventDescription,
      officeName: parsed.officeName,
      officeId: parsed.officeId,
      occurredAt: parsed.eventTimestamp || "2026-09-27T10:15:00.000Z",
      raw: parsed.rawPayload,
      nonDeliveryReason: parsed.nonDeliveryReason,
    });
    expect(again.duplicate).toBe(true);
    expect(again.snapshot.ndrAttemptCount).toBe(1);

    const stored = await db.query<{
      status: string;
      operational_status: string;
      ndr_attempt_count: number;
      ndr_reason: string;
    }>(`select status, operational_status, ndr_attempt_count, ndr_reason from public.shipments where id = $1`, [
      shipmentA,
    ]);
    expect(stored.rows[0]).toMatchObject({
      status: "NDR",
      operational_status: "NDR",
      ndr_attempt_count: 1,
      ndr_reason: "Addressee cannot be located",
    });
    const history = await db.query<{ classification: string }>(
      `select classification from public.tracking_events where shipment_id = $1`,
      [shipmentA]
    );
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0].classification).toBe("NDR");
  });

  it("persists Item Delivered(Addressee) as operational DELIVERED", async () => {
    const applied = await applyIndiaPostTracking(client(), snapshot(), {
      eventCode: "ITEM_DELIVERED",
      eventDescription: "Item Delivered(Addressee)",
      officeName: "Pandhana S.O",
      officeId: null,
      occurredAt: "2026-09-28T08:00:00.000Z",
      raw: { event: "Item Delivered(Addressee)" },
      nonDeliveryReason: null,
      mapText: "Item Delivered(Addressee)",
    });
    expect(applied.snapshot.status).toBe("DELIVERED");
    expect(applied.snapshot.operationalStatus).toBe("DELIVERED");
    const stored = await db.query<{ operational_status: string }>(
      `select operational_status from public.shipments where id = $1`,
      [shipmentA]
    );
    expect(stored.rows[0].operational_status).toBe("DELIVERED");
    const classified = await db.query<{ classification: string | null }>(
      `select classification from public.tracking_events
        where shipment_id = $1 and event_code = 'ITEM_DELIVERED'`,
      [shipmentA]
    );
    expect(classified.rows[0].classification).toBe("DELIVERED");
  });

  it("stores CEPT out-for-delivery, return, and consignee delivery scans", async () => {
    const ofd = await applyIndiaPostTracking(client(), snapshot(), {
      eventCode: "OFD",
      eventDescription: "Out for delivery",
      officeName: "Pandhana S.O",
      officeId: null,
      occurredAt: "2026-09-28T08:00:00.000Z",
      raw: {},
      nonDeliveryReason: null,
    });
    expect(ofd.snapshot.status).toBe("OUT_FOR_DELIVERY");
    expect(ofd.snapshot.operationalStatus).toBe("OUT_FOR_DELIVERY");

    const returned = await applyIndiaPostTracking(client(), ofd.snapshot, {
      eventCode: "ITEM_RETURNED",
      eventDescription: "Item returned",
      officeName: "Pandhana S.O",
      officeId: null,
      occurredAt: "2026-09-29T08:00:00.000Z",
      raw: {},
      nonDeliveryReason: null,
    });
    expect(returned.snapshot.status).toBe("RTO");
    expect(returned.snapshot.operationalStatus).toBe("RTO");
    expect(returned.snapshot.rtoInitiatedAt).toBe("2026-09-29T08:00:00.000Z");

    const toSender = await applyIndiaPostTracking(client(), returned.snapshot, {
      eventCode: "ITEM_DELIVERED",
      eventDescription: "Delivered to sender",
      officeName: "KADUGODI BNPL CENTRE",
      officeId: null,
      occurredAt: "2026-09-30T08:00:00.000Z",
      raw: {},
      nonDeliveryReason: null,
    });
    expect(toSender.snapshot.status).toBe("RTO");
    expect(toSender.snapshot.operationalStatus).toBe("RTO_DELIVERED");
    expect(toSender.orderStatus).toBeNull();

    const counts = await db.query<{ operational_status: string; n: number }>(
      `select operational_status, count(*)::int as n from public.shipments
       where organization_id = $1 and barcode is not null
       group by operational_status`,
      [orgA]
    );
    expect(counts.rows).toEqual(
      expect.arrayContaining([{ operational_status: "RTO_DELIVERED", n: 1 }])
    );
  });

  it("rejects a tracking event that does not belong to a shipment", async () => {
    await expect(
      db.query(
        `insert into public.tracking_events (organization_id, shipment_id, event_code, occurred_at)
         values ($1, '22222222-2222-4222-8222-222222222222', 'NDR', now())`,
        [orgA]
      )
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects a shipment without an organization", async () => {
    await expect(
      db.query(`insert into public.shipments (order_id, weight_grams) values ('33333333-3333-4333-8333-333333333333', 100)`)
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("isolates shipment rows with the tenant membership policy", async () => {
    await db.exec(`
      create or replace function public.is_org_member(org_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = public
      as $$
        select exists (
          select 1 from public.organization_members m
          where m.organization_id = org_id and m.user_id = auth.uid()
        );
      $$;

      alter table public.shipments enable row level security;
      alter table public.tracking_events enable row level security;
      drop policy if exists shipments_tenant_all on public.shipments;
      create policy shipments_tenant_all on public.shipments
        for all using (public.is_org_member(organization_id))
        with check (public.is_org_member(organization_id));
      drop policy if exists tracking_events_tenant_all on public.tracking_events;
      create policy tracking_events_tenant_all on public.tracking_events
        for all using (public.is_org_member(organization_id))
        with check (public.is_org_member(organization_id));

      do $$ begin
        create role app_user nologin;
      exception when duplicate_object then null;
      end $$;
      grant usage on schema public to app_user;
      grant select, insert, update, delete on all tables in schema public to app_user;
    `);
    await db.exec(`select set_config('request.jwt.claim.sub', '${userA}', false)`);
    await db.exec(`set role app_user`);
    const visible = await db.query<{ organization_id: string }>(
      `select organization_id from public.shipments`
    );
    expect(visible.rows.map((row) => row.organization_id)).toEqual([orgA]);
    await db.exec(`reset role`);
  });

  it("stores chronological scans that dashboard Routing Steps can render", async () => {
    const order = await db.query<{ id: string }>(
      `insert into public.orders (organization_id, order_number) values ($1, 'PB-ROUTE-1') returning id`,
      [orgA]
    );
    const created = await db.query<{ id: string }>(
      `insert into public.shipments (
         organization_id, order_id, weight_grams, barcode, tracking_number, status, operational_status
       ) values ($1, $2, 500, 'CX075250656IN', 'CX075250656IN', 'BOOKED', 'BOOKED')
       returning id`,
      [orgA, order.rows[0].id]
    );
    const shipmentId = created.rows[0].id;
    let current: ShipmentTrackingSnapshot = {
      id: shipmentId,
      organizationId: orgA,
      orderId: order.rows[0].id,
      status: "BOOKED",
      operationalStatus: "BOOKED",
      lastEventAt: null,
      ndrAttemptCount: 0,
      rtoInitiatedAt: null,
    };

    const scans = [
      {
        eventCode: "ITEM_BOOKED",
        eventDescription: "Item Booked",
        officeName: "Pulikkal SO",
        occurredAt: "2026-10-09T06:03:44.000Z",
      },
      {
        eventCode: "ITEM_DISPATCHED",
        eventDescription: "Item Dispatched",
        officeName: "Kozhikode PH",
        occurredAt: "2026-10-09T23:14:05.000Z",
      },
      {
        eventCode: "BAG_RECEIVED",
        eventDescription: "Bag Received",
        officeName: "Kollam RMS",
        occurredAt: "2026-10-10T01:40:00.000Z",
      },
    ];
    for (const scan of scans) {
      const applied = await applyIndiaPostTracking(client(), current, {
        ...scan,
        officeId: null,
        raw: { event: scan.eventDescription },
        nonDeliveryReason: null,
      });
      expect(applied.inserted || applied.duplicate).toBe(true);
      current = applied.snapshot;
    }

    const stored = await db.query<{
      id: string;
      event_code: string;
      event_description: string;
      office_name: string;
      occurred_at: string;
    }>(
      `select id, event_code, event_description, office_name, occurred_at
         from public.tracking_events
        where organization_id = $1 and shipment_id = $2
        order by occurred_at asc`,
      [orgA, shipmentId]
    );
    expect(stored.rows).toHaveLength(3);

    const shipment = await db.query<{
      barcode: string;
      tracking_number: string;
      status: string;
      operational_status: string | null;
      last_event_description: string | null;
      last_scan_office: string | null;
      last_event_at: string | null;
    }>(
      `select barcode, tracking_number, status, operational_status,
              last_event_description, last_scan_office, last_event_at
         from public.shipments where id = $1`,
      [shipmentId]
    );
    expect(shipment.rows[0].last_event_description).toBe("Bag Received");
    expect(shipment.rows[0].operational_status).toBe("IN_TRANSIT");

    const events: TrackingEvent[] = stored.rows.map((row) => ({
      id: row.id,
      eventCode: row.event_code,
      eventDescription: row.event_description,
      officeName: row.office_name,
      occurredAt: new Date(row.occurred_at).toISOString(),
    }));
    const view = buildIndiaPostRoutingView(
      {
        barcode: shipment.rows[0].barcode,
        trackingNumber: shipment.rows[0].tracking_number,
        status: shipment.rows[0].status,
        operationalStatus: shipment.rows[0].operational_status,
        bookedAt: events[0]?.occurredAt,
        lastEventDescription: shipment.rows[0].last_event_description,
        lastScanOffice: shipment.rows[0].last_scan_office,
        lastEventAt: shipment.rows[0].last_event_at,
        shippingCity: "Eravipuram SO",
        shippingPincode: "691011",
      },
      events
    );

    expect(view.steps).toHaveLength(3);
    expect(view.steps.map((step) => step.title)).toEqual(["Item Booked", "Item Dispatched", "Bag Received"]);
    expect(view.steps.map((step) => step.office)).toEqual(["Pulikkal SO", "Kozhikode PH", "Kollam RMS"]);
    expect(view.steps.every((step) => step.dateLabel !== "—")).toBe(true);
    expect(view.steps[2]?.latest).toBe(true);
    expect(view.currentEvent).toBe("Bag Received");
    expect(view.stages.find((stage) => stage.stage === "IN_TRANSIT")).toMatchObject({
      current: true,
      completed: false,
    });
    expect(view.stages.find((stage) => stage.stage === "BOOKED")?.completed).toBe(true);
  });
});

function snapshot(): ShipmentTrackingSnapshot {
  return {
    id: shipmentA,
    organizationId: orgA,
    orderId: null,
    status: "IN_TRANSIT",
    operationalStatus: "IN_TRANSIT",
    lastEventAt: null,
    ndrAttemptCount: 0,
    rtoInitiatedAt: null,
  };
}
