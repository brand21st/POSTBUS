import type { ReactNode } from "react";
import { Logo } from "@/components/layout/logo";

export default function PublicOrderLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="min-h-full flex-1 bg-surface-soft">
      <div className="mx-auto w-full max-w-lg px-4 py-6 sm:py-10">
        <div className="mb-6">
          <Logo href="/" priority />
        </div>
        {children}
      </div>
    </main>
  );
}
