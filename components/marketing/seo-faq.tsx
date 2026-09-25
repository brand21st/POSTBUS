import type { FaqEntry } from "@/lib/seo/json-ld";

export function SeoFaq({
  title = "Frequently asked questions",
  entries,
}: {
  title?: string;
  entries: readonly FaqEntry[];
}) {
  return (
    <section aria-labelledby="faq-heading" className="border-t border-border bg-white py-16 sm:py-20">
      <div className="mx-auto w-full max-w-3xl px-5 sm:px-6 lg:px-8">
        <h2 id="faq-heading" className="text-3xl font-bold tracking-tight text-ink">
          {title}
        </h2>
        <div className="mt-8 divide-y divide-border border-y border-border">
          {entries.map((entry, index) => (
            <details key={entry.q} className="group" open={index === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5">
                <h3 className="text-left text-lg font-semibold text-ink">{entry.q}</h3>
                <span
                  aria-hidden="true"
                  className="text-xl text-muted transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="max-w-2xl pb-5 leading-relaxed text-muted">{entry.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
