-- Add Invoices and Tracking page to Pro / Business catalog floors.

update public.plans
set features = '[
  "Up to 3,000 orders per billing period",
  "Everything in Starter",
  "Bulk shipping tools",
  "Automation rules",
  "Manifest management",
  "Invoices",
  "Tracking page"
]'::jsonb
where slug = 'pro';

update public.plans
set features = '[
  "Up to 10,000 orders per billing period",
  "Everything in Pro",
  "Operational analytics",
  "Priority support",
  "WhatsApp (Wati) notifications",
  "Custom packing labels",
  "Invoices",
  "Tracking page"
]'::jsonb
where slug = 'business';
