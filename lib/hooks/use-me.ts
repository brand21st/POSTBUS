"use client";

import { useQuery } from "@tanstack/react-query";
import { api, isConfirmedSessionLoss, isTransientApiAuthError } from "@/lib/hooks/use-api";
import type { MeMembership, MeResponse } from "@/types/api";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/v1/me"),
    retry: (failureCount, error) => {
      if (isConfirmedSessionLoss(error)) return false;
      if (isTransientApiAuthError(error)) return failureCount < 2;
      return failureCount < 1;
    },
    retryDelay: (failureCount) => Math.min(1000 * 2 ** failureCount, 4000),
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
