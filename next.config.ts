import type { NextConfig } from "next";
import { securityHeaderEntries } from "./lib/security/headers";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  serverExternalPackages: ["bullmq", "ioredis", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "*": ["./assets/fonts/noto/**/*"],
  },
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [75],
    minimumCacheTTL: 86_400,
    maximumResponseBody: 6_291_456,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
        search: "",
      },
    ],
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
