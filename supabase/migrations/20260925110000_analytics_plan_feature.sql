-- Catalog Analytics as a Pro+ plan feature (replaces Operational analytics).

update public.plans
set features = '[
  "Up to 3,000 orders per billing period",
  "Everything in Starter",
  "Bulk shipping tools",
  "Automation rules",
  "Manifest management",
  "Invoices",
  "Tracking page",
  "Analytics"
]'::jsonb
where slug = 'pro';

update public.plans
set features = '[
  "Up to 10,000 orders per billing period",
  "Everything in Pro",
  "Priority support",
  "WhatsApp (Wati) notifications",
  "Custom packing labels",
  "Invoices",
  "Tracking page",
  "Analytics"
]'::jsonb
where slug = 'business';
