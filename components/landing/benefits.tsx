import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const benefits = [
  "Less manual work",
  "Fewer operational steps",
  "Centralized shipping workflow",
  "Faster order processing",
  "One place to manage shipments",
] as const;

export function Benefits() {
  return (
    <section className="bg-ink py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          light
          title="Built for teams that ship at scale."
          description="Spend less time processing shipments. Keep your shipping operation in one clear system."
        />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit, index) => (
            <article
              key={benefit}
              className={`rounded-[28px] border border-white/10 bg-white/[0.03] p-8 ${
                index === 0 ? "sm:col-span-2 lg:col-span-1" : ""
              } ${index === benefits.length - 1 ? "sm:col-span-2 lg:col-span-2" : ""}`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                Benefit
              </p>
              <h3 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
                {benefit}
              </h3>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
