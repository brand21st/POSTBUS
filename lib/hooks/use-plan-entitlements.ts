"use client";

import { useMe } from "@/lib/hooks/use-me";
import { hasPlanFeature, lockedFeatureForPath } from "@/modules/billing/entitlements";

export function usePlanEntitlements() {
  const me = useMe();
  const features = me.data?.subscription?.features ?? [];
  const trial = me.data?.subscription?.status === "TRIAL";
  return {
    loading: me.isLoading,
    features,
    trial,
    allows: (feature: string) => trial || hasPlanFeature(features, feature),
    lockForPath: (pathname: string) => {
      if (trial) return null;
      const feature = lockedFeatureForPath(pathname);
      if (!feature || hasPlanFeature(features, feature)) return null;
      return feature;
    },
  };
}
