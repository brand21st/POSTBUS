"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/hooks/use-api";
import { useIndiaPost } from "@/lib/hooks/use-india-post";
import { useMe } from "@/lib/hooks/use-me";
import {
  hasLocalIndiaPostOnboardingDismissed,
  markLocalIndiaPostOnboardingDismissed,
  shouldShowIndiaPostConnectBanner,
  shouldShowIndiaPostOnboardingModal,
} from "@/lib/dashboard/india-post-onboarding";
import type { MeResponse } from "@/types/api";

function subscribeNever() {
  return () => {};
}

export function useIndiaPostOnboarding() {
  const me = useMe();
  const indiaPost = useIndiaPost();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const userId = me.data?.user.id;
  const [localDismissed, setLocalDismissed] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLocalDismissed(hasLocalIndiaPostOnboardingDismissed(userId));
  }, [userId]);

  const showModal = shouldShowIndiaPostOnboardingModal({
    hydrated,
    meLoading: me.isLoading,
    indiaPostLoading: indiaPost.isPending,
    meError: Boolean(me.error),
    indiaPostError: Boolean(indiaPost.error),
    hasOrganization: Boolean(me.data?.organization),
    status: indiaPost.data?.status,
    dismissedAt: me.data?.user.indiaPostOnboardingDismissedAt,
    localDismissed,
  });

  const showBanner = shouldShowIndiaPostConnectBanner({
    hydrated,
    indiaPostLoading: indiaPost.isPending,
    indiaPostError: Boolean(indiaPost.error),
    hasOrganization: Boolean(me.data?.organization),
    status: indiaPost.data?.status,
    pathname,
  });

  const dismiss = useCallback(async () => {
    if (userId) markLocalIndiaPostOnboardingDismissed(userId);
    setLocalDismissed(true);
    const dismissedAt = new Date().toISOString();
    queryClient.setQueryData<MeResponse>(["me"], (current) => {
      if (!current) return current;
      return {
        ...current,
        user: { ...current.user, indiaPostOnboardingDismissedAt: dismissedAt },
      };
    });
    try {
      await api("/api/v1/me", {
        method: "PATCH",
        body: JSON.stringify({ indiaPostOnboardingDismissedAt: true }),
      });
    } catch {
      // Local skip plus optimistic /me keep the modal from returning this session.
    }
  }, [queryClient, userId]);

  return { showModal, showBanner, dismiss };
}
