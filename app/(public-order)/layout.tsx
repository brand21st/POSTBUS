import type { ReactNode } from "react";

export default function PublicOrderLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="min-h-full min-w-0 w-full flex-1 bg-zinc-50">
      {children}
    </main>
  );
}
