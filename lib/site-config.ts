export const siteConfig = {
  name: "PostBus",
  legalName: "PostBus",
  tagline: "Shopify India Post Shipping Automation",
  seoTitle: "Shopify India Post Shipping Automation | PostBus",
  description:
    "Automate Shopify India Post shipping with PostBus. Sync orders, book shipments, generate labels, automate fulfillment, track deliveries and send WhatsApp updates.",
  url: "https://postbus.in",
  contactEmail: "hello@postbus.in",
  supportWhatsapp: "918848772371",
  loginUrl: "/login",
  getStartedUrl: "/register",
  bookDemoUrl: "/contact?intent=demo",
  keywords: [
    "Shopify India Post",
    "India Post Shopify integration",
    "Shopify shipping automation",
    "India Post shipping automation",
    "India Post booking Shopify",
    "Shopify India Post shipping",
    "India Post API Shopify",
    "Shopify shipping India",
  ],
} as const;

export const navLinks = [
  {
    label: "Product",
    href: "/features",
    children: [
      { label: "Features", href: "/features" },
      { label: "Automation", href: "/#automation" },
      { label: "Shopify", href: "/#shopify" },
      { label: "India Post", href: "/#india-post" },
    ],
  },
  { label: "Features", href: "/features" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Pricing", href: "/pricing" },
  {
    label: "Resources",
    href: "/contact",
    children: [
      { label: "Help Center", href: "/contact" },
      { label: "Documentation", href: "/contact" },
      { label: "Blog", href: "/contact" },
      { label: "Contact", href: "/contact" },
    ],
  },
] as const;

export const footerLinks = {
  product: [
    { label: "Features", href: "/features" },
    { label: "Pricing", href: "/pricing" },
    { label: "Integrations", href: "/#integrations" },
    { label: "Automation", href: "/#automation" },
  ],
  company: [
    { label: "About", href: "/features" },
    { label: "Contact", href: "/contact" },
  ],
  resources: [
    { label: "Help Center", href: "/contact" },
    { label: "Documentation", href: "/contact" },
    { label: "Blog", href: "/contact" },
  ],
  legal: [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
  ],
} as const;
