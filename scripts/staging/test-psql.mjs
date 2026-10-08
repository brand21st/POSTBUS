import { runPsql } from "./pg-rpc.mjs";

const org = "00000000-0000-0000-0000-000000000001";
const t = Date.now();
const r = await runPsql(
  `update public.background_jobs as j set status='RUNNING', locked_at=now() from (select id from public.background_jobs where organization_id='${org}'::uuid and job_type='shipment-booking' and status='QUEUED' order by created_at for update skip locked limit 1) x where j.id=x.id returning j.id::text || ',' || coalesce(j.entity_id::text,'')`
);
console.log(JSON.stringify({ r, ms: Date.now() - t }));
