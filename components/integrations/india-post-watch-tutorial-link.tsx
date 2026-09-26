import { WatchTutorialLink } from "@/components/integrations/shopify-watch-tutorial-link";

export const INDIA_POST_INTEGRATION_VIDEO_URL = "https://youtu.be/fs5Yy0vzGKI";

export function IndiaPostWatchTutorialLink({ className }: { className?: string }) {
  return (
    <WatchTutorialLink href={INDIA_POST_INTEGRATION_VIDEO_URL} className={className}>
      Watch India Post Integration tutorial
    </WatchTutorialLink>
  );
}
