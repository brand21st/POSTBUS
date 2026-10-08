import { withSentryConfig } from "@sentry/nextjs/config";
import path from "node:path";
import type { NextConfig } from "next";
import { securityHeaderEntries } from "./lib/security/headers";

const rasterClient = "./modules/labels/unicode/raster-client.ts";
const canvasStub = "./modules/labels/unicode/canvas-browser-stub.ts";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  serverExternalPackages: ["bullmq", "ioredis", "@napi-rs/canvas", "sharp"],
  turbopack: {
    resolveAlias: {
      "@napi-rs/canvas": { browser: canvasStub },
      "@/modules/labels/unicode/shaped": { browser: rasterClient },
      "@/modules/labels/unicode/raster": { browser: rasterClient },
      "@/modules/labels/unicode/canvas-native": { browser: canvasStub },
    },
  },
  outputFileTracingIncludes: {
    "*": ["./assets/fonts/noto/**/*", "./node_modules/@napi-rs/canvas/**/*"],
  },
  webpack: (config, { isServer }) => {
    config.externals = config.externals ?? [];
    if (Array.isArray(config.externals)) {
      config.externals.push({ "@napi-rs/canvas": "commonjs @napi-rs/canvas" });
    }
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "@napi-rs/canvas": false,
        "@/modules/labels/unicode/shaped": path.resolve(__dirname, "modules/labels/unicode/raster-client.ts"),
        "@/modules/labels/unicode/raster": path.resolve(__dirname, "modules/labels/unicode/raster-client.ts"),
        "@/modules/labels/unicode/canvas-native": path.resolve(__dirname, "modules/labels/unicode/canvas-browser-stub.ts"),
      };
    }
    return config;
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

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "postbusin",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
