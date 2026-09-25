import type { Metadata } from "next";
import { Suspense } from "react";
import { ContactForm } from "@/components/contact/contact-form";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get started with PostBus, book a demo, or ask about Shopify India Post shipping automation and India Post Shopify integration.",
  keywords: [...siteConfig.keywords],
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <section className="bg-surface py-16 sm:py-20">
      <Container>
        <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionHeading
              align="left"
              as="h1"
              eyebrow="Contact"
              title="Let's talk about your shipping workflow."
              description="Tell us about your Shopify store and India Post shipping setup. We'll follow up about getting started or booking a demo."
              className="max-w-xl"
            />
            <div className="mt-8 rounded-[24px] border border-border bg-white p-5 text-sm text-muted">
              <p className="font-semibold text-ink">Email</p>
              <a
                href={`mailto:${siteConfig.contactEmail}`}
                className="mt-1 inline-block text-brand hover:underline"
              >
                {siteConfig.contactEmail}
              </a>
              <p className="mt-4 font-semibold text-ink">Website</p>
              <p className="mt-1">{siteConfig.url.replace("https://", "")}</p>
            </div>
          </div>
          <Suspense
            fallback={
              <div className="h-[520px] animate-pulse rounded-[28px] border border-border bg-white" />
            }
          >
            <ContactForm />
          </Suspense>
        </div>
      </Container>
    </section>
  );
}
