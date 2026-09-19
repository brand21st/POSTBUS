import { Check } from "lucide-react";
import { WhatsAppDemo } from "@/components/landing/whatsapp-demo";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const notifications = [
  "Order confirmation",
  "Shipment booked",
  "Shipped",
  "Out for delivery",
  "Delivered",
  "Returned",
  "RTO",
  "Important tracking updates",
] as const;

export function VachatShowcase() {
  return (
    <section id="vachat" className="bg-surface py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          eyebrow="Vachat"
          title={
            <>
              PostBus ships.
              <br />
              Vachat keeps customers informed.
            </>
          }
          description="Connect Vachat with PostBus and automatically keep customers updated on WhatsApp as their orders move through the shipping journey."
        />

        <div className="mt-14 grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-ink">
              Shipping updates that talk to your customers.
            </h3>
            <p className="mt-4 text-base leading-relaxed text-muted">
              Automated WhatsApp notifications for the moments that matter —
              without your team sending each message by hand.
            </p>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {notifications.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2.5 rounded-2xl border border-border bg-white px-3.5 py-3 text-sm font-medium text-ink"
                >
                  <Check className="size-4 shrink-0 text-brand" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <WhatsAppDemo />
        </div>
      </Container>
    </section>
  );
}
