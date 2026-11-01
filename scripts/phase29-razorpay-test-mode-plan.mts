/** Razorpay test-mode plan. Refuses live keys and does not charge. */
const key = process.env.RAZORPAY_KEY_ID || "";
const live = key.startsWith("rzp_live_");
console.log(JSON.stringify({
  executable: false,
  liveKeyDetected: live,
  reason: live ? "live_razorpay_key" : "staging_not_approved",
  steps: [
    "Use rzp_test_ key on isolated staging only",
    "Reuse existing webhook verifier in modules/billing",
    "Do not register a second production webhook",
    "Confirm duplicate event_id does not insert a second commission",
    "Confirm POSTBUS_AFFILIATE_ACCRUAL_ENABLED is staging-only if used",
  ],
}, null, 2));
process.exit(1);
