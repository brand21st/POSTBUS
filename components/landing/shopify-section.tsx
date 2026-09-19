import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

export function ShopifySection() {
  return (
    <section id="shopify" className="bg-white py-20 sm:py-24 lg:py-28">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading
              align="left"
              eyebrow="Shopify"
              title={
                <>
                  Your Shopify store.
                  <br />
                  Connected to shipping.
                </>
              }
              description="Bring orders into PostBus automatically, then process shipments without jumping between portals."
            />
            <Link
              href={siteConfig.getStartedUrl}
              className={cn(
                buttonVariants({ variant: "primary", size: "lg" }),
                "group mt-8 inline-flex"
              )}
            >
              Connect Shopify
              <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-border bg-surface p-6 card-shadow-lg">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                    Shopify Order
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
                    Order #10482
                  </h3>
                </div>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  Paid
                </span>
              </div>
              <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted">Products</dt>
                  <dd className="mt-1 font-semibold text-ink">3 Products</dd>
                </div>
                <div>
                  <dt className="text-muted">Total</dt>
                  <dd className="mt-1 font-semibold text-ink">₹2,499</dd>
                </div>
                <div>
                  <dt className="text-muted">Customer</dt>
                  <dd className="mt-1 font-semibold text-ink">Meera</dd>
                </div>
                <div>
                  <dt className="text-muted">Delivery</dt>
                  <dd className="mt-1 font-semibold text-ink">Kerala</dd>
                </div>
              </dl>
              <span className="mt-6 flex w-full items-center justify-center rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white">
                Process Shipment
              </span>
            </div>

            <div className="flex flex-col items-center gap-2 text-sm font-medium text-muted">
              <ArrowDown className="size-4 text-brand" />
              <span className="rounded-full border border-border bg-white px-3 py-1.5 text-ink">
                PostBus
              </span>
              <ArrowDown className="size-4 text-brand" />
              <span>Shipment Created</span>
              <ArrowDown className="size-4 text-brand" />
              <span>Label Generated</span>
              <ArrowDown className="size-4 text-brand" />
              <span className="font-semibold text-ink">Tracking Synced</span>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
