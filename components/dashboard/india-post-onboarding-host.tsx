"use client";

import { IndiaPostConnectBanner } from "@/components/dashboard/india-post-connect-banner";
import { IndiaPostOnboardingDialog } from "@/components/dashboard/india-post-onboarding-dialog";
import { useIndiaPostOnboarding } from "@/lib/hooks/use-india-post-onboarding";

export function IndiaPostOnboardingHost() {
  const { showModal, showBanner, dismiss } = useIndiaPostOnboarding();

  return (
    <>
      {showBanner ? <IndiaPostConnectBanner /> : null}
      <IndiaPostOnboardingDialog open={showModal} onDismiss={dismiss} />
    </>
  );
}
