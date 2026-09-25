-- Align Starter / Pro / Business feature lists with dashboard entitlement floors.

update public.plans
set features = '[
  "Up to 500 orders per billing period",
  "Shopify order sync",
  "Shipment workspace",
  "Label and barcode workflows",
  "India Post booking"
]'::jsonb
where slug = 'starter';

update public.plans
set features = '[
  "Up to 3,000 orders per billing period",
  "Everything in Starter",
  "Bulk shipping tools",
  "Automation rules",
  "Manifest management"
]'::jsonb
where slug = 'pro';

update public.plans
set features = '[
  "Up to 10,000 orders per billing period",
  "Everything in Pro",
  "Operational analytics",
  "Priority support",
  "WhatsApp (Wati) notifications",
  "Custom packing labels"
]'::jsonb
where slug = 'business';
