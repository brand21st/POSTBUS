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
  const historyFeatures = me.data?.subscription?.historyFeatures ?? [];
  const entitled = me.data?.subscription?.entitled ?? trial;
  return {
    loading: me.isLoading,
    features,
    trial,
    planSlug,
    entitled,
    showsOfficialIndiaPostLabel: showsStarterOfficialIndiaPostLabel({ slug: planSlug, trial }),
    allows: (feature: string) => trial || hasPlanFeature(features, feature),
    lockForPath: (pathname: string) => {
      if (trial) return null;
      const feature = lockedFeatureForPath(pathname);
      if (!feature || hasPlanFeature(features, feature)) return null;
      // Ended coverage keeps read access to history pages; the server refuses writes.
      if (!entitled && hasPlanFeature(historyFeatures, feature)) return null;
      return feature;
    },
  };
}
