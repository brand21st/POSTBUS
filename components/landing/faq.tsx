"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const faqs = [
  {
    q: "What is PostBus?",
    a: "PostBus is Shopify India Post shipping automation for merchants in India. Sync orders, book shipments through the India Post API, generate labels, automate fulfillment, track deliveries and send WhatsApp updates.",
  },
  {
    q: "How does PostBus work with Shopify?",
    a: "Connect your Shopify store once. PostBus syncs orders into a shipping workspace so your team can process shipments without copying details between systems.",
  },
  {
    q: "What shipping operations can PostBus automate?",
    a: "PostBus is built around shipment booking, barcode handling, label generation, manifest creation, tracking organization and Shopify fulfillment updates — with automation rules for repetitive steps.",
  },
  {
    q: "Can I process shipments in bulk?",
    a: "Yes. PostBus supports bulk shipment processing so you can work through multiple orders instead of handling them one by one.",
  },
  {
    q: "Can PostBus generate labels and manifests?",
    a: "Yes. Label generation and manifest management are part of the core PostBus workflow.",
  },
  {
    q: "Does PostBus sync tracking information?",
    a: "PostBus is designed to keep shipment tracking information organized and synchronized as part of your shipping workflow.",
  },
  {
    q: "Can I connect more than one store?",
    a: "PostBus is built as multi-tenant SaaS software. Talk to us about connecting the stores and workspaces your team needs.",
  },
  {
    q: "Can I use PostBus with other integrations?",
    a: "PostBus focuses on Shopify and India Post shipping workflows first, with an architecture ready for additional integrations as your operations grow.",
  },
] as const;

export function Faq() {
  return (
    <section className="bg-surface py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          eyebrow="FAQ"
          title="Questions, answered clearly."
          description="Straight answers about what PostBus does — and what it is built for."
        />
        <div className="mx-auto mt-12 max-w-3xl rounded-[28px] border border-border bg-white px-5 sm:px-8 card-shadow">
          <Accordion type="single" defaultValue="0">
            {faqs.map((faq, index) => (
              <AccordionItem key={faq.q} value={String(index)}>
                <AccordionTrigger value={String(index)}>{faq.q}</AccordionTrigger>
                <AccordionContent value={String(index)}>{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </Container>
    </section>
  );
}
