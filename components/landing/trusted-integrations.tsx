import { Container } from "@/components/ui/container";

const badges = ["SHOPIFY", "INDIA POST", "WHATSAPP", "WOOCOMMERCE"] as const;

export function TrustedIntegrations() {
  return (
    <section id="integrations" className="border-y border-border bg-surface py-12">
      <Container>
        <p className="text-center text-sm font-medium text-muted">
          Built for modern commerce operations
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-5">
          {badges.map((badge) => (
            <span
              key={badge}
              className="text-xs font-bold tracking-[0.22em] text-zinc-400 sm:text-sm"
            >
              {badge}
            </span>
          ))}
        </div>
      </Container>
    </section>
  );
}
