import type { ReactNode } from "react";

export default function PublicTrackingLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="min-h-full flex-1">
      {children}
    </main>
  );
}
