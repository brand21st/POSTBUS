import { Suspense } from "react";
import { TrackingView } from "./tracking-view";

export default function TrackingPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading tracking…</p>}>
      <TrackingView />
    </Suspense>
  );
}
