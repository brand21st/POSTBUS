import { NextResponse, type NextRequest } from "next/server";
import { logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
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

  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ success: true, duplicate: true });
    }
    logError("razorpay.webhook_store_failed", { message: error.message });
    return NextResponse.json({ success: false, message: "Could not store webhook." }, { status: 500 });
  }

  try {
    await processRazorpayEvent(supabase, payload, id);
    if (inserted?.id) {
      await supabase
        .from("razorpay_webhook_events")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("id", inserted.id);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed.";
    logError("razorpay.webhook_failed", { message, event: payload.event, eventId: id });
    if (inserted?.id) {
      await supabase
        .from("razorpay_webhook_events")
        .update({ status: "failed", error: message })
        .eq("id", inserted.id);
    }
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
