import {
  KeyRound,
  Layers,
  Network,
  RefreshCcw,
  ScrollText,
  ShieldCheck,
  Webhook,
  Workflow,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const items = [
  {
    icon: Layers,
    title: "Multi-tenant architecture",
    description: "Designed so each merchant workspace stays isolated and organized.",
  },
  {
    icon: KeyRound,
    title: "Role-based access",
    description: "Control who can view, process and manage shipping operations.",
  },
  {
    icon: ShieldCheck,
    title: "Secure authentication",
    description: "Protect access to store connections and shipping workflows.",
  },
  {
    icon: ScrollText,
    title: "Audit logging",
    description: "Keep a clear record of important operational actions.",
  },
  {
    icon: Network,
    title: "API-ready architecture",
    description: "Built with room to connect systems as your operations grow.",
  },
  {
    icon: Webhook,
    title: "Webhook-based integrations",
    description: "React to store and shipping events without constant polling.",
  },
  {
    icon: Workflow,
    title: "Background automation",
    description: "Run shipping workflows without keeping someone glued to the screen.",
  },
  {
    icon: RefreshCcw,
    title: "Retry-safe workflows",
    description: "Handle transient failures with safer, resilient processing paths.",
  },
] as const;

export function SecuritySection() {
  return (
    <section className="bg-surface py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          eyebrow="Reliability"
          title="Designed for serious operations."
          description="Enterprise-style foundations without unsupported certification claims."
        />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <article
              key={item.title}
              className="rounded-[24px] border border-border bg-white p-5 card-shadow"
            >
              <item.icon className="mb-4 size-5 text-brand" />
              <h3 className="text-base font-semibold text-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.description}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
