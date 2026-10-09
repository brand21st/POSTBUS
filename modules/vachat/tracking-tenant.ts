import type { SupabaseClient } from "@supabase/supabase-js";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { lookupOrdersByToken, phoneMatchesOrder } from "@/modules/support/identity";
import { parseEligibleChoiceRef } from "@/modules/vachat/eligible-orders";

const PB_ORDER = /\b(PB-\d{4,})\b/i;
const HASH_ORDER = /#\s?(\d{3,})/;

function orderTokensFromText(text: string) {
  const tokens: string[] = [];
  const pb = text.match(PB_ORDER);
  if (pb?.[1]) tokens.push(pb[1].toUpperCase());
  const hashed = text.match(HASH_ORDER);
  if (hashed?.[1]) {
    tokens.push(`#${hashed[1]}`);
    tokens.push(hashed[1]);
  }
  return [...new Set(tokens)];
}

export async function resolveTrackingOrganizationFromText(
  supabase: SupabaseClient,
  phone: string,
  text: string
) {
  const phoneDigits = extractIndiaMobileDigits(phone);
  if (!phoneDigits) return null;
  const choice = parseEligibleChoiceRef(text.trim());
  if (choice && choice.phone_digits === phoneDigits) {
    const live = await phoneMatchesOrder(supabase, choice.organization_id, choice.order_id, phoneDigits);
    if (live.ok) return choice.organization_id;
  }
  const tokens = orderTokensFromText(text);
  if (!tokens.length) return null;
  const matches: Array<{ id: string; organization_id: string }> = [];
  for (const token of tokens) {
    const rows = await lookupOrdersByToken(supabase, token);
    for (const row of rows) {
      if (!matches.some((item) => item.id === row.id)) matches.push(row);
    }
  }
  if (!matches.length) return null;
  const orgs = [...new Set(matches.map((row) => row.organization_id))];
  if (orgs.length !== 1) return null;
  const confirmed: typeof matches = [];
  for (const row of matches) {
    const live = await phoneMatchesOrder(supabase, row.organization_id, row.id, phoneDigits);
    if (live.ok) confirmed.push(row);
  }
  if (confirmed.length !== 1) return null;
  return confirmed[0].organization_id;
}
