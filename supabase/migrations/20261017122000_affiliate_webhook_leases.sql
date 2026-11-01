-- Used only when POSTBUS_AFFILIATES_ENABLED=true; does not reprocess completed billing events.
alter table public.razorpay_webhook_events add column if not exists processing_lease uuid;
alter table public.razorpay_webhook_events add column if not exists processing_until timestamptz;
create function public.claim_razorpay_webhook(p_event_id text) returns jsonb language plpgsql set search_path=public as $$
declare e public.razorpay_webhook_events; token uuid:=gen_random_uuid();
begin
 select * into e from razorpay_webhook_events where event_id=p_event_id for update;
 if e.id is null then raise exception 'Missing webhook';end if;
 if e.status in ('processed','ignored') then return jsonb_build_object('state','complete');end if;
 if e.processing_until>now() then return jsonb_build_object('state','busy');end if;
 update razorpay_webhook_events set processing_lease=token,processing_until=now()+interval '15 minutes',status='received' where id=e.id;
 return jsonb_build_object('state','claimed','id',e.id,'lease',token);
end $$;
revoke all on function public.claim_razorpay_webhook(text) from public;
grant execute on function public.claim_razorpay_webhook(text) to service_role;
