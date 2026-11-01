import type { SupabaseClient } from "@supabase/supabase-js";
/** A deployment-wide lease. A failed or abandoned attempt can be retried; a live attempt cannot be stolen. */
export async function claimBillingWebhook(db:SupabaseClient,eventId:string) {
 const {data,error}=await db.rpc("claim_razorpay_webhook",{p_event_id:eventId});
 if(error)throw new Error("Webhook claim unavailable");
 return data as {state:"claimed"|"complete"|"busy";id?:string;lease?:string};
}
