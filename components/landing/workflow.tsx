import { Check } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const promises = [
  {
    title: "Same courier, less admin",
    description:
      "India Post remains the delivery network. PostBus is the workspace for booking, labels, manifests and tracking.",
  },
  {
    title: "Your Customer ID stays yours",
    description:
      "Credentials, contracts and barcode series belong to your India Post account. PostBus connects — it does not replace the carrier.",
  },
  {
    title: "Start with a full-feature trial",
    description:
      "New workspaces get a 3-day trial with every PostBus feature unlocked, then continue on the plan that matches monthly volume.",
  },
] as const;

export function Workflow() {
  return (
    <section id="trust" className="bg-surface py-14 sm:py-20 lg:py-24">
      <Container>
        <SectionHeading
          eyebrow="Built for India Post shippers"
          title="Clearer operations. No invented social proof."
          description="We do not publish fake review counts or unnamed customer quotes. Here is what the product actually does."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {promises.map((item) => (
            <article
              key={item.title}
              className="rounded-[24px] border border-border bg-white p-6"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="size-5 stroke-[2.5]" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.description}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
