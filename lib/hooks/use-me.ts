"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/hooks/use-api";
import type { MeMembership, MeResponse } from "@/types/api";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/v1/me"),
  });
}

export function membershipsFromMe(me?: MeResponse | null): MeMembership[] {
  if (!me) return [];
  if (me.organizations?.length) return me.organizations;
  if (me.memberships?.length) return me.memberships;
  if (me.organization) {
    return [{ id: me.organization.id, name: me.organization.name, slug: me.organization.slug }];
  }
  return [];
}
