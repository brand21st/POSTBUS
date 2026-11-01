"use client";

import { useMe } from "@/lib/hooks/use-me";
import {
  hasPlanFeature,
  lockedFeatureForPath,
  showsStarterOfficialIndiaPostLabel,
} from "@/modules/billing/entitlements";

export function usePlanEntitlements() {
  const me = useMe();
  const features = me.data?.subscription?.features ?? [];
  const trial = Boolean(me.data?.subscription?.trial);
  const planSlug = me.data?.subscription?.planCode ?? null;
  return {
    loading: me.isLoading,
    features,
    trial,
    planSlug,
    showsOfficialIndiaPostLabel: showsStarterOfficialIndiaPostLabel({ slug: planSlug, trial }),
    allows: (feature: string) => trial || hasPlanFeature(features, feature),
    lockForPath: (pathname: string) => {
      if (trial) return null;
      const feature = lockedFeatureForPath(pathname);
      if (!feature || hasPlanFeature(features, feature)) return null;
      return feature;
    },
  };
}
