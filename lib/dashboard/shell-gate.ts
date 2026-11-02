export function shouldMountDashboardChildren(input: {
  isUnauthorized: boolean;
  hydrated: boolean;
  hasMe: boolean;
  isTransient?: boolean;
}) {
  if (input.isUnauthorized) return false;
  // Keep already-loaded pages during a transient auth failure. Do not mount
  // new protected trees until /me succeeds.
  if (input.isTransient) return input.hasMe;
  // Skip SSR of page trees (useSearchParams, etc.) until the client hydrates,
  // then mount immediately so dashboard queries do not wait on GET /me.
  return input.hydrated || input.hasMe;
}

export function shouldRedirectToLoginFromMe(input: {
  isLoading: boolean;
  isConfirmedSessionLoss: boolean;
  isTransient: boolean;
}) {
  if (input.isLoading || input.isTransient) return false;
  return input.isConfirmedSessionLoss;
}

export function shouldRedirectToOnboardingFromMe(input: {
  isLoading: boolean;
  hasError: boolean;
  isConfirmedSessionLoss: boolean;
  isTransient: boolean;
  hasOrganization: boolean;
  membershipCount: number;
}) {
  if (input.isLoading || input.hasError || input.isConfirmedSessionLoss || input.isTransient) {
    return false;
  }
  return !input.hasOrganization && input.membershipCount === 0;
}

export function overlayDashboardUntilMeReady(isLoading: boolean) {
  return isLoading;
}
