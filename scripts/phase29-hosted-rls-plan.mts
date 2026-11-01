/** Document-only hosted RLS plan. Does not connect and does not write. */
const identities = ["affiliate_a", "affiliate_b", "merchant_a", "merchant_b", "platform_admin", "anon"];
const checks = [
  "Affiliate A cannot select Affiliate B commissions",
  "Affiliate A cannot update Affiliate B profile",
  "Merchant A cannot select Merchant B tax invoices",
  "Authenticated cannot execute affiliate_accrue",
  "Authenticated cannot execute affiliate_summary",
  "Anon has no grant on affiliate_* tables",
  "Partner API uses service role only after session identity",
];
console.log(JSON.stringify({
  executable: false,
  reason: "staging_not_approved",
  identities,
  checks,
  required: [
    "AFFILIATE_STAGING_PROJECT_REF matches SUPABASE_PROJECT_REF",
    "AFFILIATE_STAGING_WRITE_AUTHORIZATION=AFFILIATE_STAGING_WRITE_APPROVED",
    "Target is not hgacoeoovjxkzfbesmvl",
  ],
}, null, 2));
process.exit(1);
