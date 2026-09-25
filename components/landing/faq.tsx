import { faqs } from "@/components/landing/faq-data";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

export function Faq() {
  return (
    <section id="faq" className="bg-surface py-14 sm:py-20 lg:py-24">
      <Container>
        <SectionHeading
          eyebrow="FAQ"
          title="Straight answers before you start."
          description="The questions merchants ask when they already ship with India Post."
        />
        <div className="mx-auto mt-12 max-w-3xl divide-y divide-border rounded-[28px] border border-border bg-white px-5 card-shadow sm:px-8">
          {faqs.map((faq, index) => (
            <details key={faq.q} className="group py-1" open={index === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-base font-semibold text-ink transition-colors hover:text-brand sm:text-lg">
                <h3 className="font-inherit text-inherit">{faq.q}</h3>
                <span
                  aria-hidden="true"
                  className="text-xl text-muted transition-transform group-open:rotate-45 group-open:text-brand"
                >
                  +
                </span>
              </summary>
              <p className="pb-5 text-base leading-relaxed text-muted">{faq.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
