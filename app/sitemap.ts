import type { MetadataRoute } from "next";
import { publicRoutes } from "@/lib/seo/routes";
import { siteConfig } from "@/lib/site-config";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map((route) => ({
    url: `${siteConfig.url}${route.path === "/" ? "" : route.path}`,
    lastModified: new Date("2026-09-26"),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
