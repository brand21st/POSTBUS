import type { TrackingPageBanner } from "@/types/api";

export function BannerAds({ banners }: { banners: TrackingPageBanner[] }) {
  const visible = banners.filter((banner) => banner.enabled !== false && banner.imageUrl);
  if (visible.length === 0) return null;

  return (
    <aside className="grid gap-3 sm:grid-cols-3">
      {visible.map((banner) => {
        const image = (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={banner.imageUrl ?? ""}
            alt={banner.alt || "Store advertisement"}
            className="h-28 w-full rounded-xl object-cover"
          />
        );
        if (!banner.href) {
          return <div key={banner.id}>{image}</div>;
        }
        return (
          <a key={banner.id} href={banner.href} target="_blank" rel="noopener noreferrer">
            {image}
          </a>
        );
      })}
    </aside>
  );
}
