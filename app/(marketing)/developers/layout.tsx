import type { ReactNode } from "react";
import { DevelopersNav } from "@/app/(marketing)/developers/docs-nav";

export default function DevelopersLayout({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-border bg-[linear-gradient(180deg,#fff1f2_0%,#fafafa_140px)]">
      <div className="mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="border-border py-6 lg:sticky lg:top-[72px] lg:h-[calc(100vh-72px)] lg:overflow-y-auto lg:border-r lg:py-10 lg:pr-6">
            <p className="mb-5 hidden text-sm font-semibold text-ink lg:block">Developer platform</p>
            <DevelopersNav />
          </aside>
          <div className="min-w-0 pb-16 pt-2 lg:pl-10 lg:pt-10">{children}</div>
        </div>
      </div>
    </div>
  );
}
