import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

export const INDIA_POST_INTEGRATION_HREF = "/dashboard/integrations/india-post#india-post-connection";
export const INDIA_POST_ONBOARDING_STORAGE_PREFIX = "postbus.onboarding.india-post.v1:";

export function isIndiaPostConnected(status?: string | null) {
  return (status ?? "").toUpperCase() === "CONNECTED";
}

export function indiaPostOnboardingStorageKey(userId: string) {
  return `${INDIA_POST_ONBOARDING_STORAGE_PREFIX}${userId}`;
}

export function hasLocalIndiaPostOnboardingDismissed(userId: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(indiaPostOnboardingStorageKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function markLocalIndiaPostOnboardingDismissed(userId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(indiaPostOnboardingStorageKey(userId), "1");
  } catch {
    // private mode should not block dismissing the overlay
  }
}

export function shouldShowIndiaPostOnboardingModal(input: {
  hydrated: boolean;
  meLoading: boolean;
  indiaPostLoading: boolean;
  meError: boolean;
  indiaPostError: boolean;
  hasOrganization: boolean;
  status?: string | null;
  dismissedAt?: string | null;
  localDismissed: boolean;
}) {
  if (!input.hydrated || input.meLoading || input.indiaPostLoading) return false;
  if (input.meError || input.indiaPostError) return false;
  if (!input.hasOrganization) return false;
  if (isIndiaPostConnected(input.status)) return false;
  if (input.dismissedAt || input.localDismissed) return false;
  return true;
}

export function shouldShowIndiaPostConnectBanner(input: {
  hydrated: boolean;
  indiaPostLoading: boolean;
  indiaPostError: boolean;
  hasOrganization: boolean;
  status?: string | null;
  pathname: string;
}) {
  if (!input.hydrated || input.indiaPostLoading || input.indiaPostError) return false;
  if (!input.hasOrganization) return false;
  if (input.pathname === "/dashboard/integrations/india-post") return false;
  return !isIndiaPostConnected(input.status);
}

export async function dismissIndiaPostOnboardingForUser(supabase: SupabaseClient, userId: string) {
  const dismissedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("profiles")
    .update({ india_post_onboarding_dismissed_at: dismissedAt })
    .eq("id", userId)
    .select("india_post_onboarding_dismissed_at")
    .maybeSingle();
  if (error) {
    throw new AppError(ERROR_CODES.PROFILE_UNAVAILABLE, "Could not save onboarding preference.");
  }
  return {
    dismissed: true as const,
    indiaPostOnboardingDismissedAt: data?.india_post_onboarding_dismissed_at ?? dismissedAt,
  };
}
