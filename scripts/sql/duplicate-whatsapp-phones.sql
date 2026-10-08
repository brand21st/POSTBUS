-- Read-only duplicate WhatsApp report.
-- Do not update, merge, or delete user rows from this script.
-- Resolve manually: keep the org-bearing or oldest account. Never auto-merge.
-- Do not add a unique index on profiles.whatsapp_number until this returns zero rows.

select
  whatsapp_number,
  count(*) as profile_count,
  array_agg(id order by created_at) as profile_ids,
  min(created_at) as oldest_created_at
from public.profiles
where whatsapp_number is not null
  and length(trim(whatsapp_number)) > 0
group by whatsapp_number
having count(*) > 1
order by count(*) desc, whatsapp_number;
