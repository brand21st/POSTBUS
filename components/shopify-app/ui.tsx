"use client";

import type { ReactNode } from "react";
import { errorMessage } from "@/components/shopify-app/api";
import type { BadgeTone } from "@/components/shopify-app/format";

export function StatusBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  return <s-badge tone={tone}>{label}</s-badge>;
}

/** Placeholder sized like a real section so content does not jump in (keeps CLS low). */
export function SectionSkeleton({ heading, lines = 3 }: { heading?: string; lines?: number }) {
  return (
    <s-section heading={heading}>
      <s-stack gap="small-200">
        {Array.from({ length: lines }, (_, index) => (
          <s-box key={index} background="subdued" borderRadius="base" minBlockSize="20px" />
        ))}
      </s-stack>
    </s-section>
  );
}

export function ErrorBanner({ error, heading = "Something went wrong", onRetry }: { error: unknown; heading?: string; onRetry?: () => void }) {
  return (
    <s-banner tone="critical" heading={heading}>
      <s-paragraph>{errorMessage(error)}</s-paragraph>
      {onRetry ? (
        <s-button slot="secondary-actions" onClick={onRetry}>
          Try again
        </s-button>
      ) : null}
    </s-banner>
  );
}

export function EmptyState({ heading, children, action }: { heading: string; children: ReactNode; action?: ReactNode }) {
  return (
    <s-section>
      <s-stack gap="base" alignItems="center" padding="large">
        <s-heading>{heading}</s-heading>
        <s-paragraph color="subdued">{children}</s-paragraph>
        {action}
      </s-stack>
    </s-section>
  );
}
