import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for the PostBus marketing website and product inquiries.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <section className="bg-white py-16 sm:py-20">
      <Container className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
          Legal
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Terms of Service
        </h1>
        <p className="mt-4 text-sm text-muted">Last updated: 18 September 2026</p>

        <div className="prose-legal mt-10 space-y-8 text-[15px] leading-relaxed text-foreground">
          <section>
            <h2>1. Agreement</h2>
            <p>
              By using the PostBus website at {siteConfig.url}, you agree to these Terms
              of Service. If you do not agree, please do not use the site.
            </p>
          </section>

          <section>
            <h2>2. What this site is</h2>
            <p>
              This website is a public marketing site for PostBus, a shipping automation
              platform for Shopify merchants in India. It is not the PostBus application
              dashboard. Product access, pricing confirmation, and service agreements are
              handled separately during onboarding.
            </p>
          </section>

          <section>
            <h2>3. Inquiries and demos</h2>
            <p>
              Submitting a contact form or demo request does not create a paid
              subscription or guarantee service availability. We may respond using the
              contact details you provide.
            </p>
          </section>

          <section>
            <h2>4. Acceptable use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>Misuse the website or attempt to disrupt its operation</li>
              <li>Submit unlawful, misleading, or harmful content</li>
              <li>Scrape or copy substantial site content without permission</li>
            </ul>
          </section>

          <section>
            <h2>5. Intellectual property</h2>
            <p>
              The PostBus name, logo, website design, and related content are owned by
              PostBus or its licensors. You may not use them without prior written
              permission, except as needed to browse this website.
            </p>
          </section>

          <section>
            <h2>6. Third-party services</h2>
            <p>
              References to Shopify, India Post, WhatsApp, WooCommerce, or other platforms
              describe product compatibility or workflow context. They do not imply
              partnership, endorsement, or affiliation unless separately stated.
            </p>
          </section>

          <section>
            <h2>7. Disclaimers</h2>
            <p>
              The website is provided on an &quot;as is&quot; and &quot;as available&quot;
              basis. We do not guarantee uninterrupted availability or that marketing
              descriptions will match every future product configuration. Shipping
              outcomes depend on carrier networks and merchant configuration.
            </p>
          </section>

          <section>
            <h2>8. Limitation of liability</h2>
            <p>
              To the fullest extent permitted by applicable law, PostBus is not liable for
              indirect, incidental, special, consequential, or punitive damages arising
              from use of this marketing website.
            </p>
          </section>

          <section>
            <h2>9. Governing law</h2>
            <p>
              These terms are governed by the laws of India, without regard to conflict of
              law principles. Courts in India shall have exclusive jurisdiction over
              disputes arising from these terms, subject to applicable law.
            </p>
          </section>

          <section>
            <h2>10. Changes</h2>
            <p>
              We may update these Terms from time to time. Continued use of the website
              after changes means you accept the updated Terms.
            </p>
          </section>

          <section>
            <h2>11. Contact</h2>
            <p>
              Questions about these Terms:{" "}
              <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>
            </p>
          </section>
        </div>
      </Container>
    </section>
  );
}
