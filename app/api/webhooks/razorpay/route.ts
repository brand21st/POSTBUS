import { NextResponse, type NextRequest } from "next/server";
import { logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { claimWebhookEvent, finishWebhookEvent } from "@/modules/billing/webhook-lease";
import { isUniqueViolation, processRazorpayEvent, razorpayWebhookEventId } from "@/modules/billing/webhooks";
import { getRazorpayWebhookSecret } from "@/modules/razorpay/config";
import { verifyWebhookSignature } from "@/modules/razorpay/signature";

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

  if (error && !isUniqueViolation(error)) {
    logError("razorpay.webhook_store_failed", { message: error.message });
    return NextResponse.json({ success: false, message: "Could not store webhook." }, { status: 500 });
  }

  // A repeated delivery is not automatically a duplicate: if the earlier attempt
  // failed (or its worker died), Razorpay's retry must be processed again.
  let claim;
  try {
    claim = await claimWebhookEvent(supabase, id, error ? null : inserted?.id ?? null);
  } catch {
    if (error) return NextResponse.json({ success: true, duplicate: true });
    return NextResponse.json({ success: false, message: "Webhook processing is temporarily unavailable." }, { status: 503 });
  }
  if (claim.state === "complete") {
    return NextResponse.json({ success: true, duplicate: true });
  }
  if (claim.state === "busy") {
    return NextResponse.json({ success: false, message: "Webhook is being processed." }, { status: 409 });
  }
  if (claim.state === "missing") {
    if (error) return NextResponse.json({ success: true, duplicate: true });
    return NextResponse.json({ success: false, message: "Webhook was not stored." }, { status: 500 });
  }

  try {
    const result = await processRazorpayEvent(supabase, payload, id);
    const ignored = Boolean(result && "ignored" in result && result.ignored);
    await finishWebhookEvent(supabase, claim, { status: ignored ? "ignored" : "processed" });
    return NextResponse.json({ success: true, ignored });
  } catch (processError) {
    const message = processError instanceof Error ? processError.message : "Webhook processing failed.";
    logError("razorpay.webhook_failed", { message, event: payload.event, eventId: id });
    await finishWebhookEvent(supabase, claim, { status: "failed", error: message });
    return NextResponse.json({ success: false, message: "Webhook processing failed." }, { status: 500 });
  }
}
