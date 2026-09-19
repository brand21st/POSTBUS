import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

export function Ecosystem() {
  return (
    <section className="bg-white py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          title="Shipping automation meets customer communication."
          description="PostBus handles the operational workflow. Vachat handles the customer conversation."
        />

        <div className="mx-auto mt-14 max-w-3xl">
          <div className="flex flex-col items-center gap-3 text-center">
            <Node label="SHOPIFY" />
            <Connector />
            <Node label="POSTBUS" accent />
            <div className="grid w-full max-w-xl grid-cols-3 gap-2 sm:gap-3">
              <Node label="ORDERS" small />
              <Node label="SHIPPING" small />
              <Node label="TRACKING" small />
            </div>
            <Connector />
            <Node label="INDIA POST" />
            <Connector />
            <Node label="VACHAT" accent />
            <Connector />
            <Node label="WHATSAPP" />
            <Connector />
            <Node label="CUSTOMER" accent />
          </div>
        </div>
      </Container>
    </section>
  );
}

function Node({
  label,
  accent = false,
  small = false,
}: {
  label: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 font-semibold tracking-tight ${
        accent
          ? "border-brand/30 bg-brand text-white"
          : "border-border bg-surface text-ink"
      } ${small ? "text-xs sm:text-sm" : "text-sm sm:text-base"}`}
    >
      {label}
    </div>
  );
}

function Connector() {
  return <div className="h-6 w-px bg-brand/40" aria-hidden />;
}
