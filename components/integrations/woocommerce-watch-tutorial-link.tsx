import { WatchTutorialLink } from "@/components/integrations/shopify-watch-tutorial-link";

export const WOOCOMMERCE_INTEGRATION_VIDEO_URL = "https://youtu.be/f62tiXcOKGY";

export function WooCommerceWatchTutorialLink({ className }: { className?: string }) {
  return (
    <WatchTutorialLink href={WOOCOMMERCE_INTEGRATION_VIDEO_URL} className={className}>
      Watch WooCommerce Store Integration tutorial
    </WatchTutorialLink>
  );
}
