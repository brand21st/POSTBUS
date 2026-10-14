export function shouldMountDashboardChildren(input: {
  isUnauthorized: boolean;
  hydrated: boolean;
  hasMe: boolean;
  isTransient?: boolean;
}) {
  if (input.isUnauthorized) return false;
  // Transient auth failures keep the shell mounted so a retry can restore /me
  // without treating the user as signed out.
  if (input.isTransient) return input.hydrated || input.hasMe;
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

export function overlayDashboardUntilMeReady(isLoading: boolean) {
  return isLoading;
}
