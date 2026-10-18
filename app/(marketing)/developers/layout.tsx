import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";
import { DevelopersNav } from "@/app/(marketing)/developers/docs-nav";

export default function DevelopersLayout({ children }: { children: ReactNode }) {
  return (
    <Container className="py-12">
      <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand">Developer platform</p>
          <DevelopersNav />
        </aside>
        <article className="prose prose-neutral max-w-none text-ink">{children}</article>
      </div>
    </Container>
  );
}
