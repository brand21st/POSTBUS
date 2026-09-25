import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { marketingMetadata } from "@/lib/seo/metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = marketingMetadata({
  title: "Privacy Policy",
  description: "Privacy Policy for PostBus — how we handle information on postbus.in.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <section className="bg-white py-16 sm:py-20">
      <Container className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
          Legal
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm text-muted">Last updated: 18 September 2026</p>

        <div className="prose-legal mt-10 space-y-8 text-[15px] leading-relaxed text-foreground">
          <section>
            <h2>1. Who we are</h2>
            <p>
              PostBus (&quot;PostBus&quot;, &quot;we&quot;, &quot;us&quot;) operates the marketing
              website at {siteConfig.url}. This Privacy Policy explains how we handle
              information collected through this website.
            </p>
          </section>

          <section>
            <h2>2. Information we collect</h2>
            <p>When you contact us through this website, you may provide:</p>
            <ul>
              <li>Name</li>
              <li>Email address</li>
              <li>Shopify store URL</li>
              <li>Message content and inquiry intent</li>
            </ul>
            <p>
              We may also receive standard technical information from your browser such as
              IP address, device type, and pages visited through hosting or analytics
              tools if they are enabled. When enabled, PostBus uses Microsoft Clarity to
              understand aggregate website usage and improve the user experience.
            </p>
          </section>

          <section>
            <h2>3. How we use information</h2>
            <p>We use information you submit to:</p>
            <ul>
              <li>Respond to demos, onboarding, and general inquiries</li>
              <li>Understand product interest and improve our website</li>
              <li>Communicate about PostBus services when you request contact</li>
            </ul>
          </section>

          <section>
            <h2>4. Sharing</h2>
            <p>
              We do not sell personal information. We may share information with service
              providers who help us operate email, hosting, or website infrastructure,
              only as needed to provide those services.
            </p>
          </section>

          <section>
            <h2>5. Data retention</h2>
            <p>
              Contact inquiries are retained as long as needed to respond and maintain a
              reasonable business record, unless a longer period is required by law.
            </p>
          </section>

          <section>
            <h2>6. Security</h2>
            <p>
              We take reasonable technical and organizational measures to protect
              information. No method of transmission or storage is completely secure.
            </p>
          </section>

          <section>
            <h2>7. Your choices</h2>
            <p>
              You may request access, correction, or deletion of contact information you
              have shared with us by emailing{" "}
              <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>.
            </p>
          </section>

          <section>
            <h2>8. Children</h2>
            <p>
              PostBus is a business product. This website is not directed at children
              under 18.
            </p>
          </section>

          <section>
            <h2>9. Changes</h2>
            <p>
              We may update this Privacy Policy from time to time. The &quot;Last
              updated&quot; date above will change when we do.
            </p>
          </section>

          <section>
            <h2>10. Contact</h2>
            <p>
              Questions about privacy:{" "}
              <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>
            </p>
          </section>
        </div>
      </Container>
    </section>
  );
}
