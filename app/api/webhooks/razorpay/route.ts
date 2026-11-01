import { NextResponse, type NextRequest } from "next/server";
import { logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { isUniqueViolation, processRazorpayEvent, razorpayWebhookEventId } from "@/modules/billing/webhooks";
import { getRazorpayWebhookSecret } from "@/modules/razorpay/config";
import { verifyWebhookSignature } from "@/modules/razorpay/signature";
import { claimBillingWebhook } from "@/modules/billing/webhook-claim";
import { affiliateEnabled } from "@/modules/affiliates/policy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const eventId =
    request.headers.get("x-razorpay-event-id") ||
    request.headers.get("x-razorpay-delivery") ||
    "";
  const webhookSecret = await getRazorpayWebhookSecret();

  if (!webhookSecret) {
    return NextResponse.json({ success: false, message: "Webhook secret is not configured." }, { status: 503 });
  }
  if (!verifyWebhookSignature(raw, signature, webhookSecret)) {
    return NextResponse.json({ success: false, message: "Invalid webhook signature." }, { status: 400 });
  }
  if (!hasAdminClient()) {
    return NextResponse.json({ success: false, message: "Server is not configured." }, { status: 503 });
  }

  let payload: { event?: string; payload?: Record<string, unknown> };
  try {
    payload = JSON.parse(raw) as { event?: string; payload?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const id = razorpayWebhookEventId(eventId, payload.event, raw);
  const { data: inserted, error } = await supabase
    .from("razorpay_webhook_events")
    .insert({
      event_id: id,
      event: payload.event ?? "unknown",
      payload,
      status: "received",
    })
    .select("id")
    .maybeSingle();

  let recordId = inserted?.id;
  let lease: string | undefined;
  if (error && !(affiliateEnabled() && isUniqueViolation(error))) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ success: true, duplicate: true });
    }
    logError("razorpay.webhook_store_failed", { message: error.message });
    return NextResponse.json({ success: false, message: "Could not store webhook." }, { status: 500 });
  }

  if (affiliateEnabled()) {
    try {
      const claim = await claimBillingWebhook(supabase, id);
      if (claim.state === "complete") return NextResponse.json({ success: true, duplicate: true });
      if (claim.state === "busy") return NextResponse.json({ success: false, message: "Webhook is being processed." }, { status: 503 });
      recordId = claim.id;
      lease = claim.lease;
    } catch {
      return NextResponse.json({ success: false, message: "Webhook processing is temporarily unavailable." }, { status: 503 });
    }
  }

  try {
    const result = await processRazorpayEvent(supabase, payload, id);
    if (recordId) {
      let completion = supabase
        .from("razorpay_webhook_events")
        .update({
          status: result && "ignored" in result && result.ignored ? "ignored" : "processed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", recordId);
      if (lease) completion = completion.eq("processing_lease", lease);
      const { error: completionError } = await completion;
      if (completionError) throw new Error("Webhook completion could not be recorded.");
    }
    return NextResponse.json({ success: true, ignored: Boolean(result && "ignored" in result && result.ignored) });
  } catch {
    const message = "Webhook processing failed.";
    logError("razorpay.webhook_failed", { message, event: payload.event, eventId: id });
    if (recordId) {
      let failure = supabase
        .from("razorpay_webhook_events")
        .update({ status: "failed", error: message, ...(lease ? { processing_until: null } : {}) })
        .eq("id", recordId);
      if (lease) failure = failure.eq("processing_lease", lease);
      await failure;
    }
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
