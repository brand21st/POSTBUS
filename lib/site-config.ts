export const siteConfig = {
  name: "PostBus",
  legalName: "PostBus",
  tagline: "India Post Shipping Management for Ecommerce",
  seoTitle: "India Post Shipping Software for Ecommerce | PostBus",
  description:
    "Connect your existing India Post Customer ID and manage orders, shipping labels, tracking and invoices from one dashboard. Built for merchants who already ship with India Post — including Shopify and manual orders.",
  url: "https://www.postbus.in",
  contactEmail: "hello@postbus.in",
  supportWhatsapp: "918848772371",
  locale: "en_IN",
  language: "en-IN",
  country: "IN",
  ogImage: "/opengraph-image",
  loginUrl: "/login",
  getStartedUrl: "/register",
  bookDemoUrl: "/contact?intent=demo",
  keywords: [
    "India Post shipping",
    "India Post ecommerce shipping",
    "India Post shipping software",
    "India Post Customer ID shipping",
    "India Post Shopify shipping",
    "India Post WooCommerce shipping",
    "India Post shipping label generator",
    "PostBus",
  ],
} as const;

export const navLinks = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Features", href: "/features" },
  { label: "Integrations", href: "/#integrations" },
  { label: "Pricing", href: "/pricing" },
  { label: "FAQ", href: "/#faq" },
  { label: "Support", href: "/contact" },
] as const;

export const footerLinks = {
  product: [
    { label: "How it works", href: "/#how-it-works" },
    { label: "Features", href: "/features" },
    { label: "Pricing", href: "/pricing" },
    { label: "India Post shipping", href: "/india-post-shipping" },
    { label: "Shopify integration", href: "/shopify-india-post" },
    { label: "WooCommerce workflow", href: "/woocommerce-india-post" },
  ],
  company: [
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
    { label: "Book a demo", href: "/contact?intent=demo" },
  ],
  legal: [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
  ],
} as const;
