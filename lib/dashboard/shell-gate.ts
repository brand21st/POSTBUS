export function shouldMountDashboardChildren(input: {
  isUnauthorized: boolean;
  hydrated: boolean;
  hasMe: boolean;
}) {
  if (input.isUnauthorized) return false;
  // Skip SSR of page trees (useSearchParams, etc.) until the client hydrates,
  // then mount immediately so dashboard queries do not wait on GET /me.
  return input.hydrated || input.hasMe;
}

export function overlayDashboardUntilMeReady(isLoading: boolean) {
  return isLoading;
}
