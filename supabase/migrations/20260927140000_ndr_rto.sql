alter type public.shipment_status add value if not exists 'NDR';

alter table public.shipments
  add column if not exists operational_status text,
  add column if not exists last_event_code text,
  add column if not exists last_event_description text,
  add column if not exists last_scan_office text,
  add column if not exists last_event_at timestamptz,
  add column if not exists last_tracked_at timestamptz,
  add column if not exists ndr_reason text,
  add column if not exists ndr_attempt_count integer not null default 0,
  add column if not exists ndr_last_attempt_at timestamptz,
  add column if not exists rto_reason text,
  add column if not exists rto_initiated_at timestamptz,
  add column if not exists delivered_at timestamptz;

alter table public.shipments
  drop constraint if exists shipments_operational_status_check;

alter table public.shipments
  add constraint shipments_operational_status_check
  check (
    operational_status is null
    or operational_status in (
      'BOOKED',
      'DISPATCHED',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'NDR',
      'RTO',
      'RTO_IN_TRANSIT',
      'RTO_DELIVERED'
    )
  );

alter table public.shipments
  drop constraint if exists shipments_ndr_attempt_count_check;

alter table public.shipments
  add constraint shipments_ndr_attempt_count_check
  check (ndr_attempt_count >= 0);

alter table public.tracking_events
  add column if not exists classification text;

alter table public.tracking_events
  drop constraint if exists tracking_events_classification_check;

alter table public.tracking_events
  add constraint tracking_events_classification_check
  check (
    classification is null
    or classification in (
      'BOOKED',
      'DISPATCHED',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'NDR',
      'RTO',
      'RTO_IN_TRANSIT',
      'RTO_DELIVERED'
    )
  );

create index if not exists shipments_org_operational_idx
  on public.shipments (organization_id, operational_status);

create index if not exists shipments_org_delivered_at_idx
  on public.shipments (organization_id, delivered_at);
