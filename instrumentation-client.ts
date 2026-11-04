// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { initAnalytics, isShopifyEmbeddedPath } from "@/lib/analytics/posthog";

// Inside Shopify Admin (the embedded app) never record sessions or send product analytics:
// pages show customer names and addresses, and the App Store requires that data stays put.
const isShopifyEmbedded = typeof window !== "undefined" && isShopifyEmbeddedPath(window.location.pathname);

Sentry.init({
  dsn: "https://477292c3c3bac25e635eba09818cdb2d@o4512222663737344.ingest.us.sentry.io/4512222669897728",

  // Add optional integrations for additional features
  integrations: isShopifyEmbedded ? [] : [Sentry.replayIntegration()],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: isShopifyEmbedded ? 0 : 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: isShopifyEmbedded ? 0 : 1.0,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});

if (typeof window !== "undefined") {
  initAnalytics({
    token: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    pathname: window.location.pathname,
    hostname: window.location.hostname,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
