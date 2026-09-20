revoke all on function public.has_org_role(uuid, public.member_role[]) from public;
revoke all on function public.has_org_role(uuid, public.member_role[]) from anon;
grant execute on function public.has_org_role(uuid, public.member_role[]) to authenticated;
