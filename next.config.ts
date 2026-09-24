import type { NextConfig } from "next";
import { securityHeaderEntries } from "./lib/security/headers";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  serverExternalPackages: ["bullmq", "ioredis"],
  images: {
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "recharts",
      "@radix-ui/react-select",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-dialog",
      "@radix-ui/react-tabs",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-switch",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaderEntries(),
      },
    ];
  },
};

export default nextConfig;
