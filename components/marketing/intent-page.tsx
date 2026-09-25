import Link from "next/link";
import { Check } from "lucide-react";
import { SeoFaq } from "@/components/marketing/seo-faq";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import {
  breadcrumbJsonLd,
  faqJsonLd,
  serializeJsonLd,
  webPageJsonLd,
  type FaqEntry,
} from "@/lib/seo/json-ld";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

type ContentSection = {
  title: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
};

type RelatedLink = {
  href: string;
  label: string;
  description: string;
};

export function IntentPage({
  eyebrow,
  title,
  description,
  directAnswer,
  path,
  sections,
  steps,
  faqs,
  relatedLinks,
}: {
  eyebrow: string;
  title: string;
  description: string;
  directAnswer: string;
  path: string;
  sections: readonly ContentSection[];
  steps: readonly { title: string; description: string }[];
  faqs: readonly FaqEntry[];
  relatedLinks: readonly RelatedLink[];
}) {
  const schemas = [
    webPageJsonLd({ name: title, description, path }),
    breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: eyebrow, path },
    ]),
    faqJsonLd(faqs),
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(schemas) }}
      />
      <section className="border-b border-border bg-white py-14 sm:py-20">
        <Container className="max-w-5xl">
          <nav aria-label="Breadcrumb" className="mb-8 text-sm text-muted">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href="/" className="hover:text-brand hover:underline">
                  Home
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-ink">
                {eyebrow}
              </li>
            </ol>
          </nav>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">{eyebrow}</p>
          <h1 className="mt-4 max-w-4xl text-balance text-4xl font-extrabold tracking-tight text-ink sm:text-5xl lg:text-6xl">
            {title}
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted">{description}</p>
          <div className="mt-8 rounded-[24px] border border-brand/20 bg-brand/5 p-6 sm:p-7">
            <h2 className="text-lg font-bold text-ink">The short answer</h2>
            <p className="mt-2 leading-relaxed text-zinc-700">{directAnswer}</p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={siteConfig.getStartedUrl}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "rounded-full")}
            >
              Start Free Trial
            </Link>
            <Link
              href="/pricing"
              className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "rounded-full")}
            >
              View PostBus pricing
            </Link>
          </div>
        </Container>
      </section>

      <section className="bg-surface py-16 sm:py-20">
        <Container className="max-w-5xl">
          <div className="grid gap-6 lg:grid-cols-2">
            {sections.map((section) => (
              <article key={section.title} className="rounded-[24px] border border-border bg-white p-6 sm:p-8">
                <h2 className="text-2xl font-bold tracking-tight text-ink">{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mt-4 leading-relaxed text-muted">
                    {paragraph}
                  </p>
                ))}
                {section.bullets ? (
                  <ul className="mt-5 space-y-3">
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-3 text-sm leading-relaxed text-zinc-700">
                        <Check className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-y border-border bg-white py-16 sm:py-20">
        <Container className="max-w-5xl">
          <h2 className="text-3xl font-bold tracking-tight text-ink">How the workflow works</h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-2">
            {steps.map((step, index) => (
              <li key={step.title} className="rounded-[22px] border border-border p-6">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
                  Step {index + 1}
                </p>
                <h3 className="mt-2 text-xl font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{step.description}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="bg-surface py-16 sm:py-20">
        <Container className="max-w-5xl">
          <h2 className="text-3xl font-bold tracking-tight text-ink">Related PostBus guides</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {relatedLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-[22px] border border-border bg-white p-6 transition hover:border-brand/30 hover:shadow-sm"
              >
                <h3 className="font-semibold text-ink">{link.label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{link.description}</p>
                <span className="mt-4 inline-block text-sm font-semibold text-brand">
                  Learn more →
                </span>
              </Link>
            ))}
          </div>
          <p className="mt-8 text-sm leading-relaxed text-muted">
            PostBus is independent shipping management software. It is not affiliated with,
            endorsed by, or part of India Post, Shopify or WooCommerce.
          </p>
        </Container>
      </section>

      <SeoFaq entries={faqs} />
    </>
  );
}
